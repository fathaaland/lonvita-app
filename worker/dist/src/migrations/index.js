import * as migration_20260810_142000_initial from './20260810_142000_initial';
import * as migration_20260904_183219_phase0_organizer_role_multi_category from './20260904_183219_phase0_organizer_role_multi_category';
import * as migration_20260904_190201_phase1_event_model_organizations_stripe_removal from './20260904_190201_phase1_event_model_organizations_stripe_removal';
import * as migration_20260904_191230_phase2_organizer_volunteer_requests from './20260904_191230_phase2_organizer_volunteer_requests';
import * as migration_20260904_194152_phase4_location_mandatory from './20260904_194152_phase4_location_mandatory';
import * as migration_20260904_195210_phase5_notifications from './20260904_195210_phase5_notifications';
import * as migration_20260904_205318_phase6_event_location_radius from './20260904_205318_phase6_event_location_radius';
import * as migration_20260914_185435_notes_tuning from './20260914_185435_notes_tuning';
import * as migration_20260914_203243_event_image_position from './20260914_203243_event_image_position';
import * as migration_20260917_173648_remove_anyone_rule_for_creation from './20260917_173648_remove_anyone_rule_for_creation';
import * as migration_20260921_142125_add_event_is_hidden from './20260921_142125_add_event_is_hidden';
export const migrations = [
    {
        up: migration_20260810_142000_initial.up,
        down: migration_20260810_142000_initial.down,
        name: '20260810_142000_initial',
    },
    {
        up: migration_20260904_183219_phase0_organizer_role_multi_category.up,
        down: migration_20260904_183219_phase0_organizer_role_multi_category.down,
        name: '20260904_183219_phase0_organizer_role_multi_category',
    },
    {
        up: migration_20260904_190201_phase1_event_model_organizations_stripe_removal.up,
        down: migration_20260904_190201_phase1_event_model_organizations_stripe_removal.down,
        name: '20260904_190201_phase1_event_model_organizations_stripe_removal',
    },
    {
        up: migration_20260904_191230_phase2_organizer_volunteer_requests.up,
        down: migration_20260904_191230_phase2_organizer_volunteer_requests.down,
        name: '20260904_191230_phase2_organizer_volunteer_requests',
    },
    {
        up: migration_20260904_194152_phase4_location_mandatory.up,
        down: migration_20260904_194152_phase4_location_mandatory.down,
        name: '20260904_194152_phase4_location_mandatory',
    },
    {
        up: migration_20260904_195210_phase5_notifications.up,
        down: migration_20260904_195210_phase5_notifications.down,
        name: '20260904_195210_phase5_notifications',
    },
    {
        up: migration_20260904_205318_phase6_event_location_radius.up,
        down: migration_20260904_205318_phase6_event_location_radius.down,
        name: '20260904_205318_phase6_event_location_radius',
    },
    {
        up: migration_20260914_185435_notes_tuning.up,
        down: migration_20260914_185435_notes_tuning.down,
        name: '20260914_185435_notes_tuning',
    },
    {
        up: migration_20260914_203243_event_image_position.up,
        down: migration_20260914_203243_event_image_position.down,
        name: '20260914_203243_event_image_position',
    },
    {
        up: migration_20260917_173648_remove_anyone_rule_for_creation.up,
        down: migration_20260917_173648_remove_anyone_rule_for_creation.down,
        name: '20260917_173648_remove_anyone_rule_for_creation',
    },
    {
        up: migration_20260921_142125_add_event_is_hidden.up,
        down: migration_20260921_142125_add_event_is_hidden.down,
        name: '20260921_142125_add_event_is_hidden'
    },
];
