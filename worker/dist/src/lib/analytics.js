/**
 * Pomocné čisté funkce pro analytiku admin dashboardu.
 * Vše počítáno na klientovi z dat omezených přes RLS na obec.
 */
/** Age on a given date from an ISO date-of-birth string — shared by the Datavita calc and the report. */
export function ageOn(dobIso, on) {
    const dob = new Date(dobIso);
    let age = on.getFullYear() - dob.getFullYear();
    const m = on.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && on.getDate() < dob.getDate()))
        age--;
    return age;
}
export function periodStart(period) {
    if (period === "all")
        return null;
    const days = parseInt(period, 10);
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
}
export function periodLabel(period) {
    return period === "all" ? "celé období" : `posledních ${period} dní`;
}
function inPeriod(iso, start) {
    if (!start)
        return true;
    return new Date(iso).getTime() >= start.getTime();
}
export function filterEvents(events, start) {
    return events.filter((e) => inPeriod(e.date_time, start));
}
export function filterRegistrations(regs, start) {
    return regs.filter((r) => inPeriod(r.created_at, start));
}
export function computeKpis(events, regs, profiles) {
    const now = Date.now();
    const eventsUpcoming = events.filter((e) => new Date(e.date_time).getTime() >= now && e.status === "active").length;
    const eventsPast = events.filter((e) => new Date(e.date_time).getTime() < now).length;
    const approved = regs.filter((r) => r.status === "approved");
    const pending = regs.filter((r) => r.status === "pending");
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const activeUserIds = new Set(approved.filter((r) => new Date(r.created_at).getTime() >= cutoff30).map((r) => r.user_id));
    const newUserIds = profiles.filter((p) => new Date(p.created_at).getTime() >= cutoff30);
    const activeOrganizers = new Set(events.map((e) => e.organizer_id)).size;
    // Fill rate per akce (bereme jen akce s kapacitou > 0)
    const fillRates = [];
    for (const e of events) {
        if (!e.capacity)
            continue;
        const count = approved.filter((r) => r.event_id === e.id).length;
        fillRates.push(Math.min(1, count / e.capacity));
    }
    const avgFillRate = fillRates.length ? fillRates.reduce((a, b) => a + b, 0) / fillRates.length : 0;
    // Opakovaná účast
    const userCounts = new Map();
    for (const r of approved)
        userCounts.set(r.user_id, (userCounts.get(r.user_id) ?? 0) + 1);
    const totalActive = userCounts.size;
    const repeating = Array.from(userCounts.values()).filter((c) => c >= 2).length;
    const repeatParticipationRate = totalActive ? repeating / totalActive : 0;
    const avgEventsPerActive = totalActive
        ? Array.from(userCounts.values()).reduce((a, b) => a + b, 0) / totalActive
        : 0;
    return {
        eventsTotal: events.length,
        eventsUpcoming,
        eventsPast,
        approvedRegs: approved.length,
        pendingRegs: pending.length,
        activeUsers30d: activeUserIds.size,
        newUsers30d: newUserIds.length,
        activeOrganizers,
        avgFillRate,
        repeatParticipationRate,
        avgEventsPerActive,
    };
}
/* ===== Časové řady (po týdnech) ===== */
function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay(); // 0 ne ... 6 so
    const diff = day === 0 ? -6 : 1 - day; // pondělí
    x.setDate(x.getDate() + diff);
    return x;
}
function fmtWeek(d) {
    return `${d.getDate()}.${d.getMonth() + 1}.`;
}
export function weeklySeries(events, regs, weeks = 12) {
    const today = startOfWeek(new Date());
    const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const wStart = new Date(today);
        wStart.setDate(wStart.getDate() - i * 7);
        const wEnd = new Date(wStart);
        wEnd.setDate(wEnd.getDate() + 7);
        const evs = events.filter((e) => {
            const t = new Date(e.date_time).getTime();
            return t >= wStart.getTime() && t < wEnd.getTime();
        }).length;
        const rs = regs.filter((r) => {
            if (r.status !== "approved")
                return false;
            const t = new Date(r.created_at).getTime();
            return t >= wStart.getTime() && t < wEnd.getTime();
        }).length;
        out.push({ week: fmtWeek(wStart), events: evs, registrations: rs });
    }
    return out;
}
/* ===== Datavita score =====
 * Kompozitní index vitality komunity 0-100, podle funkční spec dashboardu obce (sekce 6):
 *
 *   D1 (participace) = 0,5 × Míra_zapojení + 0,5 × Retence
 *   D2 (organizace)  = 0,5 × Organizátoři_index + 0,5 × Podíl_dobrovolníků
 *   Datavita_jádro   = 0,5 × D1 + 0,5 × D2
 *
 * Bezpečnostní práh: < 30 aktivních účastníků NEBO < 5 akcí v okně → score = null
 * ("nedostatek dat"), přesně podle spec §6.7.
 *
 * Dvě záměrné odchylky od plné spec, dokud pro ně nemáme datový podklad:
 *  - Míra_zapojení dělí aktivní účastníky počtem REGISTROVANÝCH profilů 50+, ne skutečnou
 *    populací obce 50+ (tu obec zatím nikam nezadává) — fáze 1 aproximace, stejně jako
 *    v src/lib/report.ts.
 *  - Organizátoři_index normalizuje syrový počet organizátorů (ne na 1000 obyvatel 50+,
 *    tu populaci nemáme) proti vlastnímu klouzavému ročnímu průměru — self-referenční,
 *    jak spec pro fázi 1 povoluje.
 *  - Equity modifikátor (D3/D4a/D4b, ±10 bodů) NENÍ implementovaný — D3 (geografické
 *    pokrytí) potřebuje vazbu Events → MunicipalityAreas, kterou zatím events nemají.
 *    Score je tedy jen Datavita_jádro, bez equity úpravy.
 */
export const DATAVITA_MIN_PARTICIPANTS = 30;
export const DATAVITA_MIN_EVENTS = 5;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function activeParticipantIds(events, regs, ws, we) {
    const eventIds = new Set(events.filter((e) => {
        const t = new Date(e.date_time).getTime();
        return t >= ws && t < we;
    }).map((e) => e.id));
    return new Set(regs
        .filter((r) => r.attendance_status === "attended" && eventIds.has(r.event_id))
        .map((r) => r.user_id));
}
/** Trailing self-referential baseline for Organizátoři_index — average organizer count over
 * windows of the same length as `windowLengthMs`, looking back up to a year before `windowStart`. */
function trailingOrganizerReference(events, windowStart, windowLengthMs) {
    const lookbackMs = 365 * 24 * 60 * 60 * 1000;
    const counts = [];
    let cursor = windowStart;
    const earliest = windowStart - lookbackMs;
    while (cursor - windowLengthMs >= earliest) {
        cursor -= windowLengthMs;
        const orgIds = new Set(events
            .filter((e) => {
            const t = new Date(e.date_time).getTime();
            return t >= cursor && t < cursor + windowLengthMs;
        })
            .map((e) => e.organizer_id));
        counts.push(orgIds.size);
    }
    return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
}
export function computeDatavitaWindow(events, regs, profiles50Plus, windowStart, windowEnd, prevParticipants) {
    const wEvents = events.filter((e) => {
        const t = new Date(e.date_time).getTime();
        return t >= windowStart && t < windowEnd;
    });
    const participants = activeParticipantIds(events, regs, windowStart, windowEnd);
    const denominator = profiles50Plus.size || 1;
    const engagementRate = Math.min(1, participants.size / denominator);
    const returning = Array.from(prevParticipants).filter((uid) => participants.has(uid)).length;
    const retentionRate = prevParticipants.size ? returning / prevParticipants.size : 0;
    const orgIds = new Set(wEvents.map((e) => e.organizer_id));
    const reference = trailingOrganizerReference(events, windowStart, windowEnd - windowStart);
    const organizerIndex = reference > 0
        ? Math.min(100, (orgIds.size / reference) * 100)
        : orgIds.size > 0 ? 100 : 0;
    const volunteerEventIds = new Set(wEvents.filter((e) => e.is_volunteering).map((e) => e.id));
    const volunteerParticipants = new Set(regs
        .filter((r) => r.attendance_status === "attended" && volunteerEventIds.has(r.event_id))
        .map((r) => r.user_id));
    const volunteerShare = participants.size ? volunteerParticipants.size / participants.size : 0;
    const d1 = 0.5 * (engagementRate * 100) + 0.5 * (retentionRate * 100);
    const d2 = 0.5 * organizerIndex + 0.5 * (volunteerShare * 100);
    const core = 0.5 * d1 + 0.5 * d2;
    const insufficientData = participants.size < DATAVITA_MIN_PARTICIPANTS || wEvents.length < DATAVITA_MIN_EVENTS;
    return {
        score: insufficientData ? null : Math.round(core),
        participation: Math.round(d1),
        organization: Math.round(d2),
        engagementRate,
        retentionRate,
        organizerIndex,
        volunteerShare,
        activeParticipants: participants.size,
        eventsCount: wEvents.length,
    };
}
export function datavitaSeries(events, regs, profiles, weeks = 26) {
    const today = startOfWeek(new Date());
    const now = new Date();
    const profiles50Plus = new Set(profiles.filter((p) => p.date_of_birth && ageOn(p.date_of_birth, now) >= 50).map((p) => p.id));
    const approved = regs.filter((r) => r.status === "approved");
    const out = [];
    let prevParticipants = new Set();
    for (let i = weeks - 1; i >= 0; i--) {
        const wStart = new Date(today);
        wStart.setDate(wStart.getDate() - i * 7);
        const ws = wStart.getTime();
        const we = ws + ONE_WEEK_MS;
        const result = computeDatavitaWindow(events, regs, profiles50Plus, ws, we, prevParticipants);
        const wEvents = events.filter((e) => {
            const t = new Date(e.date_time).getTime();
            return t >= ws && t < we;
        });
        const fillRates = [];
        for (const e of wEvents) {
            if (!e.capacity)
                continue;
            const cnt = approved.filter((r) => r.event_id === e.id).length;
            fillRates.push(Math.min(1, cnt / e.capacity));
        }
        const fillRate = fillRates.length ? fillRates.reduce((a, b) => a + b, 0) / fillRates.length : 0;
        out.push({
            week: fmtWeek(wStart),
            weekStart: wStart.toISOString(),
            score: result.score,
            events: result.eventsCount,
            activeUsers: result.activeParticipants,
            fillRate,
        });
        prevParticipants = activeParticipantIds(events, regs, ws, we);
    }
    return out;
}
export function datavitaTrend(series) {
    if (series.length === 0)
        return { current: null, delta: 0 };
    const current = series[series.length - 1].score;
    const scored = (pts) => pts.map((p) => p.score).filter((s) => s !== null);
    const prevScores = scored(series.slice(-8, -4));
    const recentScores = scored(series.slice(-4));
    const prev = prevScores.length ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length : current;
    const recent = recentScores.length ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : current;
    if (prev === null || recent === null)
        return { current, delta: 0 };
    return { current, delta: Math.round(recent - prev) };
}
export function byCategory(events, regs, categories) {
    const approved = regs.filter((r) => r.status === "approved");
    return categories
        .map((c) => {
        const evs = events.filter((e) => e.category_ids.includes(c.id));
        const evIds = new Set(evs.map((e) => e.id));
        const cap = evs.reduce((s, e) => s + (e.capacity || 0), 0);
        const appr = approved.filter((r) => evIds.has(r.event_id)).length;
        return {
            id: c.id,
            name: c.name,
            color: c.color,
            icon: c.icon,
            events: evs.length,
            approved: appr,
            capacity: cap,
            fillRate: cap ? Math.min(1, appr / cap) : 0,
        };
    })
        .filter((c) => c.events > 0)
        .sort((a, b) => b.events - a.events);
}
/* ===== Den v týdnu ===== */
const DAY_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
export function byDayOfWeek(events) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const e of events) {
        const d = new Date(e.date_time).getDay(); // 0 ne ... 6 so
        const idx = d === 0 ? 6 : d - 1;
        counts[idx]++;
    }
    return DAY_LABELS.map((day, i) => ({ day, events: counts[i] }));
}
export function topOrganizers(events, regs, profiles, limit = 5) {
    const approved = regs.filter((r) => r.status === "approved");
    const map = new Map();
    const nameMap = new Map(profiles.map((p) => [p.id, p.full_name]));
    for (const e of events) {
        const cur = map.get(e.organizer_id) ?? {
            id: e.organizer_id,
            name: nameMap.get(e.organizer_id) ?? "Neznámý",
            events: 0,
            approved: 0,
        };
        cur.events += 1;
        cur.approved += approved.filter((r) => r.event_id === e.id).length;
        map.set(e.organizer_id, cur);
    }
    return Array.from(map.values())
        .sort((a, b) => b.approved - a.approved || b.events - a.events)
        .slice(0, limit);
}
export function topEvents(events, regs, limit = 5) {
    const approved = regs.filter((r) => r.status === "approved");
    return events
        .map((e) => {
        const a = approved.filter((r) => r.event_id === e.id).length;
        return {
            id: e.id,
            title: e.title,
            date_time: e.date_time,
            capacity: e.capacity,
            approved: a,
            fillRate: e.capacity ? Math.min(1, a / e.capacity) : 0,
        };
    })
        .sort((a, b) => b.approved - a.approved)
        .slice(0, limit);
}
/* ===== Stav přihlášek ===== */
export function regStatusBreakdown(regs) {
    const out = { approved: 0, pending: 0, rejected: 0 };
    for (const r of regs) {
        if (r.status === "approved")
            out.approved++;
        else if (r.status === "pending")
            out.pending++;
        else
            out.rejected++;
    }
    return out;
}
/* ===== Docházka ===== */
export function attendanceBreakdown(regs) {
    const marked = regs.filter((r) => r.status === "approved" && r.attendance_status && r.attendance_status !== "not_marked");
    const out = { attended: 0, no_show: 0, excused: 0 };
    for (const r of marked) {
        if (r.attendance_status === "attended")
            out.attended++;
        else if (r.attendance_status === "no_show")
            out.no_show++;
        else if (r.attendance_status === "excused")
            out.excused++;
    }
    return { ...out, total: marked.length };
}
/* ===== Hodnocení (EventFeedback) ===== */
export function averageRatings(feedback) {
    if (feedback.length === 0)
        return { avgSatisfaction: null, avgFeltWelcome: null, count: 0 };
    const avgSatisfaction = feedback.reduce((s, f) => s + f.satisfaction_rating, 0) / feedback.length;
    const welcomeRatings = feedback.filter((f) => f.felt_welcome_rating !== null);
    const avgFeltWelcome = welcomeRatings.length
        ? welcomeRatings.reduce((s, f) => s + f.felt_welcome_rating, 0) / welcomeRatings.length
        : null;
    return { avgSatisfaction, avgFeltWelcome, count: feedback.length };
}
/* ===== Naplněnost ===== */
export function fillBuckets(events, regs) {
    const approved = regs.filter((r) => r.status === "approved");
    let full = 0, ok = 0, low = 0;
    for (const e of events) {
        if (!e.capacity)
            continue;
        const a = approved.filter((r) => r.event_id === e.id).length;
        const ratio = a / e.capacity;
        if (ratio >= 0.85)
            full++;
        else if (ratio >= 0.4)
            ok++;
        else
            low++;
    }
    return { full, ok, low };
}
/* ===== CSV export ===== */
export function buildEventsCsv(events, regs, categories, profiles) {
    const cats = new Map(categories.map((c) => [c.id, c.name]));
    const profs = new Map(profiles.map((p) => [p.id, p.full_name]));
    const approved = regs.filter((r) => r.status === "approved");
    const pending = regs.filter((r) => r.status === "pending");
    const header = ["Název", "Datum", "Kategorie", "Pořadatel", "Kapacita", "Schváleno", "Čeká", "Naplněnost %", "Stav"];
    const rows = events.map((e) => {
        const a = approved.filter((r) => r.event_id === e.id).length;
        const p = pending.filter((r) => r.event_id === e.id).length;
        const fill = e.capacity ? Math.round((a / e.capacity) * 100) : 0;
        return [
            e.title,
            new Date(e.date_time).toLocaleString("cs-CZ"),
            e.category_ids.map((id) => cats.get(id)).filter(Boolean).join(", "),
            profs.get(e.organizer_id) ?? "",
            String(e.capacity),
            String(a),
            String(p),
            String(fill),
            e.status,
        ];
    });
    const escape = (v) => `"${v.replace(/"/g, '""')}"`;
    return [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}
