"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.vaultKey = exports.VAULT_SERVICE = exports.ACTIVE_ACCOUNT = exports.ACTIVE_SERVICE = exports.VERSION = exports.APP_NAME = void 0;
exports.configDir = configDir;
exports.stateFile = stateFile;
exports.defaultSettings = defaultSettings;
exports.withDefaults = withDefaults;
/* Constants, paths and default settings. */
const os = __importStar(require("os"));
const path = __importStar(require("path"));
exports.APP_NAME = "geminiswitcher";
exports.VERSION = "1.0.0";
/** OS keyring slot that agy itself reads. Single-slot per machine. */
exports.ACTIVE_SERVICE = "gemini";
exports.ACTIVE_ACCOUNT = "antigravity";
/** Our own vault namespace inside the OS keyring (one entry per account). */
exports.VAULT_SERVICE = "geminiswitcher";
const vaultKey = (accountId) => `account:${accountId}`;
exports.vaultKey = vaultKey;
/** Config/state directory. Overridable via GEMINISWITCHER_DIR (handy for tests). */
function configDir() {
    const override = process.env.GEMINISWITCHER_DIR;
    if (override && override.trim())
        return override;
    return path.join(os.homedir(), ".config", exports.APP_NAME);
}
function stateFile() {
    return path.join(configDir(), "state.json");
}
function defaultSettings() {
    return {
        autoswitch: true,
        agyPath: process.env.GEMINISWITCHER_AGY || "agy",
        loginCommands: [["login"], ["auth", "login"]],
        resumeArgs: ["-c"],
        preferConversationId: true,
        forwardUsageToAgy: true,
        handoffEnabled: false,
        injectContinuePrompt: false,
        continuePromptText: "Continuing previous session after an automatic account switch. Please carry on.",
        limitCooldownMs: 60_000,
    };
}
/** Deep-merge user settings over defaults so new defaults apply cleanly. */
function withDefaults(partial = {}) {
    return { ...defaultSettings(), ...partial };
}
