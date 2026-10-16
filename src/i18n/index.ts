/**
 * i18n bootstrap: one registry with both packs loaded, Chinese as the default.
 */
import { I18n } from './i18n.js';
import { zhCN } from './packs/zh-CN.js';
import { en } from './packs/en.js';

export const i18n = new I18n();
i18n.addPack(zhCN, { makeDefault: true });
i18n.addPack(en);

export { CMD, DIALOG, ABOUT_ITEM, PROPS_ITEM } from './commands.js';
export { I18n } from './i18n.js';
export { validateLanguagePack, assertValidLanguagePack } from './validate.js';
export type { LanguagePack, ResolvedCommand, ValidationResult, ValidationIssue } from './types.js';
