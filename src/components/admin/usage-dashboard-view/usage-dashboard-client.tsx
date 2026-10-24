'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type {
  UsageDashboardData,
  UsageDashboardModelBreakdown,
  UsageDashboardOperationBreakdown,
} from '@/lib/usage/dashboard-aggregation'

type MunicipalityOption = { id: number; name: string }
type UserOption = { id: number; email: string }

const DEFAULT_RANGE_DAYS = 30

const toDateInputValue = (date: Date): string => date.toISOString().slice(0, 10)

const todayInputValue = toDateInputValue(new Date())
const defaultFromInputValue = toDateInputValue(
  new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000),
)

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

const numberFormatter = new Intl.NumberFormat('en-US')

const compactNumberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' })

const cardStyle: React.CSSProperties = {
  flex: '1 1 200px',
  padding: '1rem 1.25rem',
  borderRadius: 'var(--style-radius-m, 4px)',
  border: '1px solid var(--theme-elevation-150)',
  background: 'var(--theme-elevation-50)',
}

const cardLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--theme-elevation-500)',
  marginBottom: '0.375rem',
}

const cardValueStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  color: 'var(--theme-elevation-800)',
}

const sectionStyle: React.CSSProperties = {
  marginTop: '2rem',
}

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  marginBottom: '0.75rem',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.8125rem',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--theme-elevation-150)',
  color: 'var(--theme-elevation-500)',
  fontWeight: 500,
}

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--theme-elevation-100)',
}

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderRadius: 'var(--style-radius-s, 3px)',
  border: '1px solid var(--theme-elevation-150)',
  background: 'var(--theme-input-bg, var(--theme-bg))',
  color: 'var(--theme-elevation-800)',
}

const chartColors = {
  cost: 'var(--theme-success-500)',
  tokens: 'var(--theme-elevation-800)',
  bar: 'var(--theme-success-450)',
}

const formatUsdTooltipValue = (value: unknown) =>
  usdFormatter.format(typeof value === 'number' ? value : Number(value ?? 0))

const formatNumberTooltipValue = (value: unknown) =>
  numberFormatter.format(typeof value === 'number' ? value : Number(value ?? 0))

const buildQuery = (params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return search.toString()
}

const modelKey = (row: UsageDashboardModelBreakdown) => `${row.provider} / ${row.model}`

export const UsageDashboardClient = () => {
  const [from, setFrom] = useState(defaultFromInputValue)
  const [to, setTo] = useState(todayInputValue)
  const [municipalityId, setMunicipalityId] = useState('')
  const [userId, setUserId] = useState('')

  const [municipalities, setMunicipalities] = useState<MunicipalityOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])

  const [data, setData] = useState<UsageDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadMunicipalities = async () => {
      const res = await fetch(
        `/api/municipalities?${buildQuery({ limit: '200', sort: 'name', depth: '0' })}`,
      )
      if (!res.ok) return
      const json = await res.json()
      setMunicipalities(
        (json.docs ?? []).map((doc: { id: number; name: string }) => ({
          id: doc.id,
          name: doc.name,
        })),
      )
    }
    void loadMunicipalities()
  }, [])

  useEffect(() => {
    if (!municipalityId) return

    // The obec's people who run imports — its admins and organizers (user-roles).
    const loadUsers = async () => {
      const query = buildQuery({
        limit: '200',
        depth: '1',
        'where[municipality][equals]': municipalityId,
        'where[role][in]': 'municipality_admin,organizer',
      })
      const res = await fetch(`/api/user-roles?${query}`)
      if (!res.ok) return
      const json = await res.json()
      const byId = new Map<number, UserOption>()
      for (const doc of (json.docs ?? []) as { user?: { id: number; email: string } | number }[]) {
        if (doc.user && typeof doc.user === 'object') {
          byId.set(doc.user.id, { id: doc.user.id, email: doc.user.email })
        }
      }
      setUsers([...byId.values()].sort((a, b) => a.email.localeCompare(b.email)))
    }
    void loadUsers()
  }, [municipalityId])

  useEffect(() => {
    // A cleared native date input yields an empty string — wait for a valid date
    // instead of building an Invalid Date query.
    if (!from || !to) return

    const controller = new AbortController()

    const loadData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Range end is exclusive server-side, so send the start of the day *after* `to` to
        // include the full end date the user selected.
        const toExclusive = new Date(`${to}T00:00:00.000Z`)
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)

        const query = buildQuery({
          from: new Date(`${from}T00:00:00.000Z`).toISOString(),
          to: toExclusive.toISOString(),
          municipalityId: municipalityId || undefined,
          userId: userId || undefined,
        })

        const res = await fetch(`/api/admin/usage-dashboard?${query}`, {
          signal: controller.signal,
        })

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error ?? `Request failed with status ${res.status}`)
        }

        const json = (await res.json()) as UsageDashboardData
        setData(json)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      } finally {
        setIsLoading(false)
      }
    }

    void loadData()

    return () => controller.abort()
  }, [from, to, municipalityId, userId])

  const timeSeriesChartData = useMemo(
    () =>
      (data?.timeSeries ?? []).map((point) => ({
        ...point,
        costUsd: Number(point.costUsd.toFixed(4)),
      })),
    [data],
  )

  const byModelChartData = useMemo(
    () =>
      (data?.byModel ?? []).slice(0, 10).map((row) => ({
        name: modelKey(row),
        costUsd: Number(row.costUsd.toFixed(4)),
      })),
    [data],
  )

  const byOperationChartData = useMemo(
    () =>
      (data?.byOperationType ?? []).map((row) => ({
        name: row.operationType,
        costUsd: Number(row.costUsd.toFixed(4)),
      })),
    [data],
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={cardLabelStyle}>From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            style={selectStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={cardLabelStyle}>To</span>
          <input
            type="date"
            value={to}
            min={from}
            max={todayInputValue}
            onChange={(e) => setTo(e.target.value)}
            style={selectStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={cardLabelStyle}>Municipality</span>
          <select
            value={municipalityId}
            onChange={(e) => {
              setMunicipalityId(e.target.value)
              setUserId('')
              // Always drop the previous municipality's users — keeping them offered while the
              // new list loads allows picking a user that can't match the municipality filter.
              setUsers([])
            }}
            style={selectStyle}
          >
            <option value="">All municipalities</option>
            {municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={cardLabelStyle}>User</span>
          <select
            value={userId}
            disabled={!municipalityId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ ...selectStyle, opacity: municipalityId ? 1 : 0.5 }}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--style-radius-m, 4px)',
            border: '1px solid var(--theme-error-300)',
            background: 'var(--theme-error-50)',
            color: 'var(--theme-error-700)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ ...sectionStyle, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Total cost</div>
          <div style={cardValueStyle}>
            {data ? usdFormatter.format(data.summary.totalCostUsd) : '—'}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Total tokens</div>
          <div style={cardValueStyle}>
            {data ? compactNumberFormatter.format(data.summary.totalTokens) : '—'}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Total requests</div>
          <div style={cardValueStyle}>
            {data ? numberFormatter.format(data.summary.totalRequests) : '—'}
          </div>
          {data && (
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--theme-elevation-500)',
                marginTop: '0.25rem',
              }}
            >
              {data.summary.successCount} success · {data.summary.errorCount} error ·{' '}
              {data.summary.abortedCount} aborted
            </div>
          )}
        </div>
        <div
          style={{
            ...cardStyle,
            border:
              data && data.summary.unpricedCount > 0
                ? '1px solid var(--theme-warning-300)'
                : cardStyle.border,
            background:
              data && data.summary.unpricedCount > 0
                ? 'var(--theme-warning-50)'
                : cardStyle.background,
          }}
        >
          <div style={cardLabelStyle}>Records with unknown pricing</div>
          <div style={cardValueStyle}>
            {data ? numberFormatter.format(data.summary.unpricedCount) : '—'}
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--theme-elevation-500)',
              marginTop: '0.25rem',
            }}
          >
            Excluded from the total cost above — real spend is higher than shown.
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>Cost over time</div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={timeSeriesChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-elevation-100)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                tickFormatter={(value: number) => usdFormatter.format(value)}
                width={90}
              />
              <Tooltip formatter={formatUsdTooltipValue} />
              <Line
                type="monotone"
                dataKey="costUsd"
                name="Cost (USD)"
                stroke={chartColors.cost}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>Tokens over time</div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={timeSeriesChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-elevation-100)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                tickFormatter={(value: number) => compactNumberFormatter.format(value)}
                width={60}
              />
              <Tooltip formatter={formatNumberTooltipValue} />
              <Line
                type="monotone"
                dataKey="tokens"
                name="Tokens"
                stroke={chartColors.tokens}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', ...sectionStyle }}>
        <div style={{ flex: '1 1 420px' }}>
          <div style={sectionHeadingStyle}>Cost by model/provider (top 10)</div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={byModelChartData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-elevation-100)" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                  tickFormatter={(value: number) => usdFormatter.format(value)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                />
                <Tooltip formatter={formatUsdTooltipValue} />
                <Bar dataKey="costUsd" name="Cost (USD)" fill={chartColors.bar} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ flex: '1 1 420px' }}>
          <div style={sectionHeadingStyle}>Cost by operation type</div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={byOperationChartData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-elevation-100)" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                  tickFormatter={(value: number) => usdFormatter.format(value)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
                />
                <Tooltip formatter={formatUsdTooltipValue} />
                <Bar dataKey="costUsd" name="Cost (USD)" fill={chartColors.bar} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>Breakdown by model/provider</div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Provider</th>
              <th style={thStyle}>Model</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Requests</th>
              <th style={thStyle}>Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byModel ?? []).map((row: UsageDashboardModelBreakdown) => (
              <tr key={modelKey(row)}>
                <td style={tdStyle}>{row.provider}</td>
                <td style={tdStyle}>{row.model}</td>
                <td style={tdStyle}>{usdFormatter.format(row.costUsd)}</td>
                <td style={tdStyle}>{numberFormatter.format(row.tokens)}</td>
                <td style={tdStyle}>{numberFormatter.format(row.requests)}</td>
                <td style={tdStyle}>
                  {row.unpricedCount > 0 ? numberFormatter.format(row.unpricedCount) : '—'}
                </td>
              </tr>
            ))}
            {data && data.byModel.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={6}>
                  No usage in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>Breakdown by operation type</div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Operation type</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Requests</th>
              <th style={thStyle}>Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byOperationType ?? []).map((row: UsageDashboardOperationBreakdown) => (
              <tr key={row.operationType}>
                <td style={tdStyle}>{row.operationType}</td>
                <td style={tdStyle}>{usdFormatter.format(row.costUsd)}</td>
                <td style={tdStyle}>{numberFormatter.format(row.tokens)}</td>
                <td style={tdStyle}>{numberFormatter.format(row.requests)}</td>
                <td style={tdStyle}>
                  {row.unpricedCount > 0 ? numberFormatter.format(row.unpricedCount) : '—'}
                </td>
              </tr>
            ))}
            {data && data.byOperationType.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={5}>
                  No usage in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isLoading && (
        <div
          style={{ marginTop: '1rem', color: 'var(--theme-elevation-500)', fontSize: '0.8125rem' }}
        >
          Loading…
        </div>
      )}
    </div>
  )
}
