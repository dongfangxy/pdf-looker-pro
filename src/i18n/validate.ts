/**
 * Language-pack validation.
 *
 * A pack is untrusted input (it may be hand-edited or shipped separately), so it is
 * checked structurally before use and every problem is reported with its path
 * rather than throwing on the first bad field.
 */
import { SECTIONS, type LanguagePack, type ValidationIssue, type ValidationResult } from './types.js';

/** Command ids are addressed numerically; dialog and control ids are numeric too. */
const ID_PATTERN = /^[0-9]{1,10}$/;
const LANG_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;
const MAX_ISSUES = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateLanguagePack(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string): void => {
    if (issues.length < MAX_ISSUES) issues.push({ path, message });
  };

  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ path: '', message: '语言包根节点必须是对象' }] };
  }

  // ---- meta ----
  if (!isPlainObject(input['meta'])) {
    add('/meta', '缺少 meta 段');
  } else {
    const meta = input['meta'];
    if (!nonEmptyString(meta['id']) || !LANG_ID_PATTERN.test(meta['id'])) {
      add('/meta/id', 'id 必须是 1-16 位、以字母开头的标识符');
    }
    if (!nonEmptyString(meta['name'])) add('/meta/name', 'name 必须是非空字符串');
    if (!nonEmptyString(meta['nativeName'])) add('/meta/nativeName', 'nativeName 必须是非空字符串');
    if (meta['lcid'] !== undefined && !nonEmptyString(meta['lcid'])) add('/meta/lcid', 'lcid 若存在必须是非空字符串');
  }

  // ---- the three required sections ----
  for (const section of SECTIONS) {
    if (!isPlainObject(input[section])) add(`/${section}`, `缺少 ${section} 段（三段式必需）`);
  }

  // ---- commands ----
  if (isPlainObject(input['commands'])) {
    const commands = input['commands'];
    let valid = 0;
    for (const [id, value] of Object.entries(commands)) {
      const path = `/commands/${id}`;
      if (!ID_PATTERN.test(id)) {
        add(path, '命令 id 必须是数字字符串');
        continue;
      }
      if (!isPlainObject(value)) {
        add(path, '命令记录必须是对象');
        continue;
      }
      if (!nonEmptyString(value['title'])) {
        add(`${path}/title`, 'title 必填且为非空字符串');
        continue;
      }
      for (const slot of ['tooltip', 'status', 'short'] as const) {
        if (value[slot] !== undefined && typeof value[slot] !== 'string') {
          add(`${path}/${slot}`, `${slot} 必须是字符串`);
        }
      }
      valid++;
    }
    if (valid === 0) add('/commands', 'commands 段没有任何合法命令记录');
  }

  // ---- dialogs ----
  if (isPlainObject(input['dialogs'])) {
    const dialogs = input['dialogs'];
    for (const [id, value] of Object.entries(dialogs)) {
      const path = `/dialogs/${id}`;
      if (!ID_PATTERN.test(id)) {
        add(path, '对话框 id 必须是数字字符串');
        continue;
      }
      if (!isPlainObject(value)) {
        add(path, '对话框记录必须是对象');
        continue;
      }
      if (!nonEmptyString(value['text'])) add(`${path}/text`, '对话框标题必填');
      const items = value['items'];
      if (items !== undefined) {
        if (!Array.isArray(items)) {
          add(`${path}/items`, 'items 必须是数组');
        } else {
          const seen = new Set<string>();
          items.forEach((item, index) => {
            const itemPath = `${path}/items/${index}`;
            if (!isPlainObject(item)) {
              add(itemPath, '控件记录必须是对象');
              return;
            }
            if (!nonEmptyString(item['id']) || !ID_PATTERN.test(item['id'])) {
              add(`${itemPath}/id`, '控件 id 必须是数字字符串');
              return;
            }
            if (seen.has(item['id'])) add(`${itemPath}/id`, `控件 id ${item['id']} 重复`);
            seen.add(item['id']);
            if (typeof item['text'] !== 'string') add(`${itemPath}/text`, '控件 text 必须是字符串');
            if (item['tooltip'] !== undefined && typeof item['tooltip'] !== 'string') {
              add(`${itemPath}/tooltip`, 'tooltip 必须是字符串');
            }
          });
        }
      }
    }
  }

  // ---- strings ----
  if (isPlainObject(input['strings'])) {
    for (const [key, value] of Object.entries(input['strings'])) {
      if (typeof value !== 'string') add(`/strings/${key}`, '字符串值必须是字符串');
    }
  }

  // ---- unknown top-level sections are reported but not fatal ----
  for (const key of Object.keys(input)) {
    if (key !== 'meta' && !(SECTIONS as readonly string[]).includes(key)) {
      add(`/${key}`, `未知段（已忽略）`);
    }
  }

  return { ok: issues.filter((i) => !i.message.includes('已忽略')).length === 0, issues };
}

/** Throws a readable error listing the first few problems. */
export function assertValidLanguagePack(input: unknown): asserts input is LanguagePack {
  const result = validateLanguagePack(input);
  if (result.ok) return;
  const detail = result.issues
    .slice(0, 6)
    .map((i) => `  ${i.path || '/'}: ${i.message}`)
    .join('\n');
  throw new Error(`语言包校验失败（${result.issues.length} 项）:\n${detail}`);
}
