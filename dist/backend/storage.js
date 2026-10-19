import { CALIBRATABLE_ACTION_TYPES, CALIBRATION_EXECUTION_PROFILES, ALL_ACTION_TYPES, DEFAULT_CHAT_TRACKING_PREFERENCES, DEFAULT_USER_SETTINGS, } from '../shared/contracts';
const SETTINGS_PATH = 'phase1/settings.json';
const PARTICIPANT_PROFILES_PATH = 'phase5/participant-profiles.json';
const CHAT_TRACKING_PREFERENCES_PATH = 'phase7/chat-tracking-preferences.json';
function buildDefaultActionMappings() {
    return ALL_ACTION_TYPES.map((semanticActionType) => ({
        semanticActionType,
        xtoysActionName: semanticActionType,
        fallbackActionName: null,
        supported: semanticActionType !== 'pause',
        updatedAt: null,
    }));
}
function buildDefaultActionCalibrationPresets() {
    return CALIBRATABLE_ACTION_TYPES.map((semanticActionType, index) => ({
        semanticActionType,
        supported: true,
        fallbackTarget: null,
        baseAmplitude: 50,
        baseTempo: 50,
        preferredExecutionProfile: CALIBRATION_EXECUTION_PROFILES[0],
        preferredTransitionStyle: semanticActionType === 'pulse' ? 'abrupt' : 'smooth',
        repeatStyle: semanticActionType === 'pulse' ? 'once' : semanticActionType === 'tease' ? 'loop' : 'hold',
        holdTendency: index % 2 === 0 ? 60 : 50,
        revision: 1,
    }));
}
function mergeSettings(settings) {
    const mappingsByType = new Map((settings.xtoysActionMappings ?? []).map((mapping) => [mapping.semanticActionType, mapping]));
    const calibrationsByType = new Map((settings.actionCalibrationPresets ?? []).map((preset) => [preset.semanticActionType, preset]));
    const merged = {
        parser: {
            ...DEFAULT_USER_SETTINGS.parser,
            ...settings.parser,
        },
        xtoysDelivery: {
            ...DEFAULT_USER_SETTINGS.xtoysDelivery,
            ...settings.xtoysDelivery,
        },
        ui: {
            ...DEFAULT_USER_SETTINGS.ui,
            ...settings.ui,
        },
        xtoysActionMappings: buildDefaultActionMappings().map((mapping) => ({
            ...mapping,
            ...mappingsByType.get(mapping.semanticActionType),
        })),
        actionCalibrationPresets: buildDefaultActionCalibrationPresets().map((preset) => ({
            ...preset,
            ...calibrationsByType.get(preset.semanticActionType),
        })),
    };
    // Migrate the earlier compatibility-mode default to the field name XToys actually reacts to.
    merged.xtoysDelivery.mode = 'action_trigger_compat';
    if (merged.xtoysDelivery.triggerFieldName === 'sendTrigger') {
        merged.xtoysDelivery.triggerFieldName = 'action';
    }
    const thrustPreset = merged.actionCalibrationPresets.find((preset) => preset.semanticActionType === 'thrust');
    if (thrustPreset) {
        thrustPreset.preferredExecutionProfile = CALIBRATION_EXECUTION_PROFILES[0];
    }
    return merged;
}
function mergeChatTrackingPreferences(preferences, settings) {
    return {
        ...DEFAULT_CHAT_TRACKING_PREFERENCES,
        primaryContactZone: settings.parser.primaryUserContactZone,
        customContactZone: settings.parser.customUserContactZone,
        ...preferences,
    };
}
export async function readUserSettings(spindle, userId) {
    const settings = await spindle.userStorage.getJson(SETTINGS_PATH, {
        fallback: DEFAULT_USER_SETTINGS,
        userId,
    });
    return mergeSettings(settings);
}
export async function writeUserSettings(spindle, userId, settings) {
    await spindle.userStorage.setJson(SETTINGS_PATH, mergeSettings(settings), {
        indent: 2,
        userId,
    });
}
export async function readChatTrackingPreferenceStore(spindle, userId) {
    return spindle.userStorage.getJson(CHAT_TRACKING_PREFERENCES_PATH, {
        fallback: { chats: {} },
        userId,
    });
}
export async function readChatTrackingPreferences(spindle, userId, chatId, settings) {
    if (!chatId) {
        return mergeChatTrackingPreferences(null, settings);
    }
    const store = await readChatTrackingPreferenceStore(spindle, userId);
    return mergeChatTrackingPreferences(store.chats[chatId], settings);
}
export async function writeChatTrackingPreferences(spindle, userId, chatId, preferences, settings) {
    const store = await readChatTrackingPreferenceStore(spindle, userId);
    store.chats[chatId] = mergeChatTrackingPreferences(preferences, settings);
    await spindle.userStorage.setJson(CHAT_TRACKING_PREFERENCES_PATH, store, {
        indent: 2,
        userId,
    });
}
export async function readParticipantProfileStore(spindle, userId) {
    return spindle.userStorage.getJson(PARTICIPANT_PROFILES_PATH, {
        fallback: { profiles: {} },
        userId,
    });
}
export async function writeParticipantProfileStore(spindle, userId, store) {
    await spindle.userStorage.setJson(PARTICIPANT_PROFILES_PATH, store, {
        indent: 2,
        userId,
    });
}
