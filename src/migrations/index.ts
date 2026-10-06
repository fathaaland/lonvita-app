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
import * as migration_20260923_121410_remove_organizations from './20260923_121410_remove_organizations';
import * as migration_20260923_130134_add_organizer_request_reason from './20260923_130134_add_organizer_request_reason';
import * as migration_20260923_133301_add_event_deletion_requests from './20260923_133301_add_event_deletion_requests';
import * as migration_20260923_141549_add_organizations from './20260923_141549_add_organizations';
import * as migration_20260923_153833_obec_organizations from './20260923_153833_obec_organizations';
import * as migration_20260927_170152_add_exports from './20260927_170152_add_exports';
import * as migration_20260928_213410_add_profile_avatars from './20260928_213410_add_profile_avatars';
import * as migration_20261002_121205_co_organizing_invitations from './20261002_121205_co_organizing_invitations';
import * as migration_20261002_133958_organization_avatars from './20261002_133958_organization_avatars';
import * as migration_20261002_140448_volunteer_pool_contact from './20261002_140448_volunteer_pool_contact';
import * as migration_20261002_141202_volunteer_invitations from './20261002_141202_volunteer_invitations';
import * as migration_20261002_144539_volunteer_map_and_ratings from './20261002_144539_volunteer_map_and_ratings';
import * as migration_20261003_084807_volunteer_applications from './20261003_084807_volunteer_applications';
import * as migration_20261003_103017_organization_description from './20261003_103017_organization_description';
import * as migration_20261003_121542_review_complaints from './20261003_121542_review_complaints';
import * as migration_20261003_130458_remove_volunteer_flag_requests from './20261003_130458_remove_volunteer_flag_requests';
import * as migration_20261004_081355_co_organizer_removal from './20261004_081355_co_organizer_removal';
import * as migration_20261004_142135_obec_left_at from './20261004_142135_obec_left_at';
import * as migration_20261004_194744_registration_cutoff from './20261004_194744_registration_cutoff';
import * as migration_20261005_153854_account_anonymization from './20261005_153854_account_anonymization';

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
    name: '20260921_142125_add_event_is_hidden',
  },
  {
    up: migration_20260923_121410_remove_organizations.up,
    down: migration_20260923_121410_remove_organizations.down,
    name: '20260923_121410_remove_organizations',
  },
  {
    up: migration_20260923_130134_add_organizer_request_reason.up,
    down: migration_20260923_130134_add_organizer_request_reason.down,
    name: '20260923_130134_add_organizer_request_reason',
  },
  {
    up: migration_20260923_133301_add_event_deletion_requests.up,
    down: migration_20260923_133301_add_event_deletion_requests.down,
    name: '20260923_133301_add_event_deletion_requests',
  },
  {
    up: migration_20260923_141549_add_organizations.up,
    down: migration_20260923_141549_add_organizations.down,
    name: '20260923_141549_add_organizations',
  },
  {
    up: migration_20260923_153833_obec_organizations.up,
    down: migration_20260923_153833_obec_organizations.down,
    name: '20260923_153833_obec_organizations',
  },
  {
    up: migration_20260927_170152_add_exports.up,
    down: migration_20260927_170152_add_exports.down,
    name: '20260927_170152_add_exports',
  },
  {
    up: migration_20260928_213410_add_profile_avatars.up,
    down: migration_20260928_213410_add_profile_avatars.down,
    name: '20260928_213410_add_profile_avatars',
  },
  {
    up: migration_20261002_121205_co_organizing_invitations.up,
    down: migration_20261002_121205_co_organizing_invitations.down,
    name: '20261002_121205_co_organizing_invitations',
  },
  {
    up: migration_20261002_133958_organization_avatars.up,
    down: migration_20261002_133958_organization_avatars.down,
    name: '20261002_133958_organization_avatars',
  },
  {
    up: migration_20261002_140448_volunteer_pool_contact.up,
    down: migration_20261002_140448_volunteer_pool_contact.down,
    name: '20261002_140448_volunteer_pool_contact',
  },
  {
    up: migration_20261002_141202_volunteer_invitations.up,
    down: migration_20261002_141202_volunteer_invitations.down,
    name: '20261002_141202_volunteer_invitations',
  },
  {
    up: migration_20261002_144539_volunteer_map_and_ratings.up,
    down: migration_20261002_144539_volunteer_map_and_ratings.down,
    name: '20261002_144539_volunteer_map_and_ratings',
  },
  {
    up: migration_20261003_084807_volunteer_applications.up,
    down: migration_20261003_084807_volunteer_applications.down,
    name: '20261003_084807_volunteer_applications',
  },
  {
    up: migration_20261003_103017_organization_description.up,
    down: migration_20261003_103017_organization_description.down,
    name: '20261003_103017_organization_description',
  },
  {
    up: migration_20261003_121542_review_complaints.up,
    down: migration_20261003_121542_review_complaints.down,
    name: '20261003_121542_review_complaints',
  },
  {
    up: migration_20261003_130458_remove_volunteer_flag_requests.up,
    down: migration_20261003_130458_remove_volunteer_flag_requests.down,
    name: '20261003_130458_remove_volunteer_flag_requests',
  },
  {
    up: migration_20261004_081355_co_organizer_removal.up,
    down: migration_20261004_081355_co_organizer_removal.down,
    name: '20261004_081355_co_organizer_removal',
  },
  {
    up: migration_20261004_142135_obec_left_at.up,
    down: migration_20261004_142135_obec_left_at.down,
    name: '20261004_142135_obec_left_at',
  },
  {
    up: migration_20261004_194744_registration_cutoff.up,
    down: migration_20261004_194744_registration_cutoff.down,
    name: '20261004_194744_registration_cutoff',
  },
  {
    up: migration_20261005_153854_account_anonymization.up,
    down: migration_20261005_153854_account_anonymization.down,
    name: '20261005_153854_account_anonymization'
  },
];
