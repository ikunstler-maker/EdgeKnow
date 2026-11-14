// Excel functions the table editor's formula engine (formula.js via
// @fortune-sheet/formula-parser) lacks, added so that formulas from Excel work
// the same here (step Т1). Ranges come in as rows of values.
import { Parser } from "@fortune-sheet/formula-parser";
import { update as formatValue } from "@fortune-sheet/core";
import * as formulajs from "@formulajs/formulajs";

type Value = string | number | boolean | null | undefined | Error;
const NA = () => new Error("#N/A");
const VALUE = () => new Error("#VALUE!");

const flat = (value: unknown): Value[] => (Array.isArray(value) ? (value as unknown[]).flatMap((v) => flat(v)) : [value as Value]);
const rows = (value: unknown): Value[][] => (Array.isArray(value) ? (Array.isArray(value[0]) ? (value as Value[][]) : [value as Value[]]) : [[value as Value]]);
// The engine gives errors as text ("#DIV/0!") or as Error objects.
const ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#ERROR!", "#GETTING_DATA", "NULL", "DIV/0", "VALUE", "REF", "NAME", "NUM", "N/A", "ERROR"]);
const isError = (v: unknown) => v instanceof Error || (typeof v === "string" && ERRORS.has(v));
const errorName = (v: unknown) => {
  const name = v instanceof Error ? v.message : String(v);
  return name.startsWith("#") ? name : name === "N/A" ? "#N/A" : name === "NAME" ? "#NAME?" : `#${name}!`;
};
const isEmpty = (v: Value) => v === null || v === undefined || v === "";
const num = (v: Value) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : NaN);

// Excel criteria: "5", ">5", "<>x", "=x", "x*", "?y" (case-insensitive, * and ? as wildcards).
function matcher(criterion: Value): (v: Value) => boolean {
  if (typeof criterion === "number" || typeof criterion === "boolean") return (v) => v === criterion || num(v) === Number(criterion);
  const text = String(criterion ?? "");
  const m = text.match(/^(<=|>=|<>|=|<|>)?([\s\S]*)$/)!;
  const op = m[1] ?? "=";
  const target = m[2];
  const n = Number(target);
  const numeric = target.trim() !== "" && !Number.isNaN(n);
  if (op !== "=" && op !== "<>" && numeric) {
    return (v) => {
      const x = num(v);
      if (Number.isNaN(x)) return false;
      return op === ">" ? x > n : op === ">=" ? x >= n : op === "<" ? x < n : x <= n;
    };
  }
  const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?")}$`, "i");
  const equal = (v: Value) => (numeric && !Number.isNaN(num(v)) ? num(v) === n : target === "" ? isEmpty(v) : pattern.test(String(v ?? "")));
  return op === "<>" ? (v) => !equal(v) : equal;
}

function conditional(values: unknown, pairs: unknown[]) {
  const out = flat(values);
  const tests: { range: Value[]; ok: (v: Value) => boolean }[] = [];
  for (let i = 0; i < pairs.length; i += 2) tests.push({ range: flat(pairs[i]), ok: matcher(pairs[i + 1] as Value) });
  return out.filter((_, index) => tests.every((test) => test.ok(test.range[index])));
}

function compare(a: Value, b: Value) {
  const x = num(a);
  const y = num(b);
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

// XMATCH's position search (1-based), or -1.
function position(lookup: Value, list: Value[], matchMode = 0, searchMode = 1): number {
  const order = searchMode === -1 || searchMode === -2 ? [...list.keys()].reverse() : [...list.keys()];
  if (matchMode === 2) {
    const ok = matcher(String(lookup ?? ""));
    const at = order.find((i) => ok(list[i]));
    return at === undefined ? -1 : at + 1;
  }
  let best = -1;
  for (const i of order) {
    const diff = compare(list[i], lookup);
    if (diff === 0) return i + 1;
    if (matchMode === -1 && diff < 0 && (best < 0 || compare(list[i], list[best - 1]) > 0)) best = i + 1;
    if (matchMode === 1 && diff > 0 && (best < 0 || compare(list[i], list[best - 1]) < 0)) best = i + 1;
  }
  return best;
}

const take = (matrix: Value[][], count: number, columns: boolean) => {
  if (!columns) return count >= 0 ? matrix.slice(0, count) : matrix.slice(count);
  return matrix.map((row) => (count >= 0 ? row.slice(0, count) : row.slice(count)));
};

const sumOf = (list: Value[]) => list.map(num).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);

const transpose = (matrix: Value[][]) => (matrix[0] ?? []).map((_, c) => matrix.map((row) => row[c]));
// Excel's sort order: numbers, then text (case-insensitive), then booleans; blanks last.
const rank = (v: Value) => (isEmpty(v) ? 4 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);
function sortOrder(x: Value, y: Value) {
  const a = rank(x);
  const b = rank(y);
  if (a !== b) return a - b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, undefined, { sensitivity: "base" });
  if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y);
  return 0;
}

export const EXTRA_FUNCTIONS: Record<string, (params: unknown[]) => unknown> = {
  // Criteria as in Excel (comparisons, <> and the * ? ~ wildcards).
  COUNTIF: ([range, criterion]) => flat(range).filter(matcher(criterion as Value)).length,
  COUNTIFS: (pairs) => {
    const first = flat(pairs[0]);
    return first.filter((_, index) => {
      for (let i = 0; i < pairs.length; i += 2) if (!matcher(pairs[i + 1] as Value)(flat(pairs[i])[index])) return false;
      return true;
    }).length;
  },
  SUMIF: ([range, criterion, sumRange]) => {
    const test = flat(range);
    const values = flat(sumRange ?? range);
    const ok = matcher(criterion as Value);
    return sumOf(values.filter((_, i) => ok(test[i])));
  },
  SUMIFS: ([range, ...pairs]) => sumOf(conditional(range, pairs)),
  AVERAGEIF: ([range, criterion, averageRange]) => {
    const test = flat(range);
    const ok = matcher(criterion as Value);
    const found = flat(averageRange ?? range).filter((_, i) => ok(test[i])).map(num).filter((n) => !Number.isNaN(n));
    return found.length ? found.reduce((a, b) => a + b, 0) / found.length : new Error("#DIV/0!");
  },
  AVERAGEIFS: ([range, ...pairs]) => {
    const found = conditional(range, pairs).map(num).filter((n) => !Number.isNaN(n));
    return found.length ? found.reduce((a, b) => a + b, 0) / found.length : new Error("#DIV/0!");
  },
  ISBLANK: ([value]) => isEmpty(value as Value),
  // The working day N working days from a date (Saturday and Sunday off, and the given holidays).
  WORKDAY: ([start, days, holidays]) => {
    const off = new Set(flat(holidays).map(num).filter((n) => !Number.isNaN(n)).map(Math.floor));
    let day = Math.floor(num(start as Value));
    let left = Math.trunc(num(days as Value));
    if (Number.isNaN(day) || Number.isNaN(left)) return VALUE();
    const step = left < 0 ? -1 : 1;
    while (left !== 0) {
      day += step;
      const weekday = (day - 1) % 7; // 0 = Sunday for Excel day numbers (day 1 was a Sunday)
      if (weekday !== 0 && weekday !== 6 && !off.has(day)) left -= step;
    }
    return day;
  },
  // Errors from operators (1/0) count as errors here too.
  IFERROR: ([value, fallback]) => (isError(value) ? fallback : value),
  IFNA: ([value, fallback]) => (isError(value) && errorName(value) === "#N/A" ? fallback : value),
  ISERROR: ([value]) => isError(value),
  ISERR: ([value]) => isError(value) && errorName(value) !== "#N/A",
  ISNA: ([value]) => isError(value) && errorName(value) === "#N/A",
  "ERROR.TYPE": ([value]) => {
    const at = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"].indexOf(errorName(value));
    return isError(value) && at >= 0 ? at + 1 : NA();
  },
  // A number shown with an Excel format code ("0%", "#,##0.00", "dd.mm.yyyy").
  TEXT: ([value, format]) => {
    try {
      return String(formatValue(String(format ?? "General"), value as never));
    } catch {
      return VALUE();
    }
  },
  XLOOKUP: ([lookup, lookupArray, returnArray, notFound, matchMode, searchMode]) => {
    const list = flat(lookupArray);
    const at = position(lookup as Value, list, Number(matchMode ?? 0), Number(searchMode ?? 1));
    if (at < 0) return notFound === undefined ? NA() : notFound;
    const back = rows(returnArray);
    // A whole row or column of results when the return range is wider than one.
    if (back.length === list.length) return back[at - 1].length === 1 ? back[at - 1][0] : [back[at - 1]];
    if (back[0]?.length === list.length) return back.length === 1 ? back[0][at - 1] : back.map((row) => [row[at - 1]]);
    return flat(returnArray)[at - 1] ?? NA();
  },
  XMATCH: ([lookup, lookupArray, matchMode, searchMode]) => {
    const at = position(lookup as Value, flat(lookupArray), Number(matchMode ?? 0), Number(searchMode ?? 1));
    return at < 0 ? NA() : at;
  },
  MAXIFS: ([range, ...pairs]) => {
    const found = conditional(range, pairs).map(num).filter((n) => !Number.isNaN(n));
    return found.length ? Math.max(...found) : 0;
  },
  MINIFS: ([range, ...pairs]) => {
    const found = conditional(range, pairs).map(num).filter((n) => !Number.isNaN(n));
    return found.length ? Math.min(...found) : 0;
  },
  TEXTJOIN: ([delimiter, ignoreEmpty, ...texts]) => {
    const all = texts.flatMap((t) => flat(t));
    return (ignoreEmpty === false || ignoreEmpty === 0 || ignoreEmpty === "FALSE" ? all : all.filter((v) => !isEmpty(v))).map((v) => (v === true ? "TRUE" : v === false ? "FALSE" : String(v ?? ""))).join(String(delimiter ?? ""));
  },
  TEXTSPLIT: ([text, columnDelimiter, rowDelimiter, ignoreEmpty]) => {
    const split = (value: string, by: unknown) => (by === undefined || by === null || by === "" ? [value] : value.split(String(by)));
    const lines = split(String(text ?? ""), rowDelimiter);
    const result = lines.map((line) => split(line, columnDelimiter).filter((part) => !(ignoreEmpty && part === "")));
    const width = Math.max(...result.map((r) => r.length));
    return result.map((r) => [...r, ...Array(width - r.length).fill(NA())]);
  },
  TEXTBEFORE: ([text, delimiter, instance]) => {
    const value = String(text ?? "");
    const parts = value.split(String(delimiter ?? ""));
    const n = Number(instance ?? 1);
    if (parts.length <= Math.abs(n)) return NA();
    return n > 0 ? parts.slice(0, n).join(String(delimiter)) : parts.slice(0, parts.length + n).join(String(delimiter));
  },
  TEXTAFTER: ([text, delimiter, instance]) => {
    const value = String(text ?? "");
    const parts = value.split(String(delimiter ?? ""));
    const n = Number(instance ?? 1);
    if (parts.length <= Math.abs(n)) return NA();
    return n > 0 ? parts.slice(n).join(String(delimiter)) : parts.slice(parts.length + n).join(String(delimiter));
  },
  TAKE: ([array, rowCount, columnCount]) => {
    let matrix = rows(array);
    if (rowCount !== undefined && rowCount !== null) matrix = take(matrix, Number(rowCount), false);
    if (columnCount !== undefined && columnCount !== null) matrix = take(matrix, Number(columnCount), true);
    return matrix;
  },
  DROP: ([array, rowCount, columnCount]) => {
    let matrix = rows(array);
    const r = Number(rowCount ?? 0);
    const c = Number(columnCount ?? 0);
    matrix = r >= 0 ? matrix.slice(r) : matrix.slice(0, r);
    if (c) matrix = matrix.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c)));
    return matrix.length ? matrix : VALUE();
  },
  CHOOSECOLS: ([array, ...columns]) => {
    const matrix = rows(array);
    const width = matrix[0]?.length ?? 0;
    return matrix.map((row) => columns.map((c) => row[(Number(c) > 0 ? Number(c) : width + Number(c) + 1) - 1] ?? VALUE()));
  },
  CHOOSEROWS: ([array, ...picks]) => {
    const matrix = rows(array);
    return picks.map((r) => matrix[(Number(r) > 0 ? Number(r) : matrix.length + Number(r) + 1) - 1] ?? [VALUE()]);
  },
  VSTACK: (arrays) => {
    const all = arrays.flatMap((a) => rows(a));
    const width = Math.max(...all.map((r) => r.length));
    return all.map((r) => [...r, ...Array(width - r.length).fill(NA())]);
  },
  HSTACK: (arrays) => {
    const parts = arrays.map((a) => rows(a));
    const height = Math.max(...parts.map((p) => p.length));
    return Array.from({ length: height }, (_, i) => parts.flatMap((p) => p[i] ?? Array(p[0]?.length ?? 1).fill(NA())));
  },
  TOCOL: ([array]) => flat(array).filter((v) => !isEmpty(v)).map((v) => [v]),
  TOROW: ([array]) => [flat(array).filter((v) => !isEmpty(v))],
  WRAPROWS: ([vector, count, pad]) => {
    const list = flat(vector);
    const n = Math.max(1, Number(count));
    const out: Value[][] = [];
    for (let i = 0; i < list.length; i += n) out.push([...list.slice(i, i + n), ...Array(Math.max(0, n - list.slice(i, i + n).length)).fill(pad ?? NA())]);
    return out;
  },
  WRAPCOLS: ([vector, count, pad]) => {
    const wrapped = EXTRA_FUNCTIONS.WRAPROWS([vector, count, pad]) as Value[][];
    return wrapped[0].map((_, c) => wrapped.map((row) => row[c]));
  },
  EXPAND: ([array, rowCount, columnCount, pad]) => {
    const matrix = rows(array);
    const r = Number(rowCount ?? matrix.length);
    const c = Number(columnCount ?? matrix[0]?.length ?? 1);
    return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => matrix[i]?.[j] ?? pad ?? NA()));
  },
  // Package 4: dynamic-array functions used inside other formulas (the cell shows the result as before).
  ARRAYLITERAL: ([columns, ...values]) => {
    const width = Math.max(1, Number(columns));
    const out: Value[][] = [];
    for (let i = 0; i < values.length; i += width) out.push(values.slice(i, i + width) as Value[]);
    return out;
  },
  SORT: ([array, index, order, byColumn]) => {
    const matrix = byColumn === true ? transpose(rows(array)) : rows(array);
    const at = Number(index ?? 1) - 1;
    const sign = Number(order ?? 1) === -1 ? -1 : 1;
    if (at < 0 || at >= (matrix[0]?.length ?? 0)) return VALUE();
    const sorted = [...matrix].sort((x, y) => sign * sortOrder(x[at], y[at]));
    return byColumn === true ? transpose(sorted) : sorted;
  },
  SORTBY: ([array, ...pairs]) => {
    const matrix = rows(array);
    const keys: { values: Value[]; sign: number }[] = [];
    for (let i = 0; i < pairs.length; i += 2) keys.push({ values: flat(pairs[i]), sign: Number(pairs[i + 1] ?? 1) === -1 ? -1 : 1 });
    if (keys.some((key) => key.values.length !== matrix.length)) return VALUE();
    const order = matrix.map((_, i) => i).sort((x, y) => {
      for (const key of keys) {
        const c = sortOrder(key.values[x], key.values[y]);
        if (c) return key.sign * c;
      }
      return 0;
    });
    return order.map((i) => matrix[i]);
  },
  FILTER: ([array, include, ifEmpty]) => {
    const matrix = rows(array);
    const keep = flat(include);
    if (isError(keep.find((v) => isError(v)))) return keep.find((v) => isError(v));
    // A column of conditions keeps rows; a row of them keeps columns.
    const byColumn = keep.length !== matrix.length;
    if (byColumn && keep.length !== (matrix[0]?.length ?? 0)) return VALUE();
    const truthy = (v: Value) => (typeof v === "number" ? v !== 0 : v === true || (typeof v === "string" && v.toUpperCase() === "TRUE"));
    const out = byColumn ? matrix.map((row) => row.filter((_, j) => truthy(keep[j]))) : matrix.filter((_, i) => truthy(keep[i]));
    if (!out.length || !out[0].length) return ifEmpty === undefined ? new Error("#CALC!") : ifEmpty;
    return out;
  },
  UNIQUE: ([array, byColumn, exactlyOnce]) => {
    const matrix = byColumn === true ? transpose(rows(array)) : rows(array);
    const keyOf = (row: Value[]) => JSON.stringify(row.map((v) => (typeof v === "string" ? v.toLowerCase() : v ?? "")));
    const counts = new Map<string, number>();
    for (const row of matrix) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
    const seen = new Set<string>();
    const out = matrix.filter((row) => {
      const key = keyOf(row);
      if (seen.has(key) || (exactlyOnce === true && counts.get(key) !== 1)) return false;
      seen.add(key);
      return true;
    });
    if (!out.length) return new Error("#CALC!");
    return byColumn === true ? transpose(out) : out;
  },
  SEQUENCE: ([rowCount, columnCount, start, step]) => {
    const r = Number(rowCount ?? 1);
    const c = Number(columnCount ?? 1);
    const from = Number(start ?? 1);
    const by = Number(step ?? 1);
    if (!(r >= 1) || !(c >= 1)) return new Error("#CALC!");
    return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => from + (i * c + j) * by));
  },
  "STDEV.S": (values) => {
    const list = values.flatMap((v) => flat(v)).map(num).filter((n) => !Number.isNaN(n));
    if (list.length < 2) return new Error("#DIV/0!");
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / (list.length - 1));
  },
  "STDEV.P": (values) => {
    const list = values.flatMap((v) => flat(v)).map(num).filter((n) => !Number.isNaN(n));
    if (!list.length) return new Error("#DIV/0!");
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length);
  },
  "RANK.EQ": ([value, ref, order]) => {
    const list = flat(ref).map(num).filter((n) => !Number.isNaN(n));
    const x = num(value as Value);
    if (!list.includes(x)) return NA();
    return Number(order ?? 0) ? list.filter((n) => n < x).length + 1 : list.filter((n) => n > x).length + 1;
  },
  "PERCENTILE.INC": ([array, k]) => {
    const list = flat(array).map(num).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    const p = Number(k);
    if (!list.length || p < 0 || p > 1) return new Error("#NUM!");
    const at = (list.length - 1) * p;
    const low = Math.floor(at);
    return list[low] + (list[Math.min(low + 1, list.length - 1)] - list[low]) * (at - low);
  },
};

// Excel's dotted names (MODE.SNGL, VAR.S, QUARTILE.INC…) that formula.js keeps nested.
function dotted(name: string): ((params: unknown[]) => unknown) | undefined {
  const [group, member] = name.split(".");
  if (!member) return undefined;
  const fn = (formulajs as unknown as Record<string, Record<string, unknown> | undefined>)[group]?.[member];
  return typeof fn === "function" ? (params: unknown[]) => (fn as (...args: unknown[]) => unknown)(...params) : undefined;
}

const DATE_FUNCTIONS = new Set(["DATE", "DATEVALUE", "EDATE", "EOMONTH", "WORKDAY", "WORKDAY.INTL", "TODAY", "NOW", "TIME"]);
// As Excel: a date is a day number (1 = 1 January 1900), a time its fraction.
const asExcelDate = (value: unknown) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  const days = (Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return days + (value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds()) / 86_400;
};

// The format a formula's result gets, as Excel gives it: a date for =DATE(…), a time for =NOW().
export function formatForFormula(formula: unknown): { fa: string; t: string } | null {
  const head = String(formula ?? "").match(/^=\s*([A-Z.]+)\(/i)?.[1]?.toUpperCase();
  if (!head) return null;
  if (head === "NOW") return { fa: "dd\\.mm\\.yyyy hh:mm", t: "d" };
  if (head === "TIME") return { fa: "hh:mm", t: "d" };
  return DATE_FUNCTIONS.has(head) ? { fa: "dd\\.mm\\.yyyy", t: "d" } : null;
}

// --- Package 4: what the engine's grammar lacks, rewritten before it parses ---------------------------
// The stored formula keeps its own text; only the engine sees the rewritten one.

const CELL = String.raw`\$?([A-Za-z]{1,3})\$?(\d+)`;
const SHEET = String.raw`(?:(?:'[^']+'|[\p{L}\w.]+)!)?`;
const columnNumber = (label: string) => [...label.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// Text in quotes is set aside (as placeholders) so nothing inside it is rewritten.
function protectStrings(formula: string) {
  const strings: string[] = [];
  const text = formula.replace(/"(?:[^"]|"")*"/g, (m) => `\u0000${strings.push(m) - 1}\u0000`);
  return { text, restore: (value: string) => value.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[Number(i)]) };
}

// The arguments of the call whose "(" is at `open`, split at top-level commas.
function argumentsAt(text: string, open: number) {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") {
      depth--;
      if (depth === 0) {
        args.push(text.slice(start, i));
        return { args, end: i };
      }
    } else if (ch === "," && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

// ROW(B5) → 5, COLUMN(C1) → 3, ROWS(A1:A4) → 4, COLUMNS(A1:C1) → 3 (with a reference written out).
function rewriteReferences(text: string) {
  const pattern = new RegExp(String.raw`(?<![\p{L}\w.])(ROWS|COLUMNS|ROW|COLUMN)\(\s*${SHEET}${CELL}(?:\s*:\s*${CELL})?\s*\)`, "giu");
  return text.replace(pattern, (whole, fn: string, c1: string, r1: string, c2?: string, r2?: string) => {
    const name = fn.toUpperCase();
    if (name === "ROW") return String(Math.min(Number(r1), Number(r2 ?? r1)));
    if (name === "COLUMN") return String(Math.min(columnNumber(c1), columnNumber(c2 ?? c1)));
    if (name === "ROWS") return String(Math.abs(Number(r2 ?? r1) - Number(r1)) + 1);
    return String(Math.abs(columnNumber(c2 ?? c1) - columnNumber(c1)) + 1);
  });
}

// {1,2;3,4} → ARRAYLITERAL(2,1,2,3,4): rows split by ";", columns by ",".
function rewriteArrays(text: string) {
  return text.replace(/\{([^{}]*)\}/g, (whole, body: string) => {
    const table = body.split(";").map((row) => row.split(",").map((v) => v.trim()));
    const width = table[0].length;
    if (table.some((row) => row.length !== width || row.some((v) => v === ""))) return whole;
    return `ARRAYLITERAL(${width},${table.flat().join(",")})`;
  });
}

// LET(name, value, …, result): each name replaced by its value in brackets, innermost LET first.
function rewriteLet(text: string): string {
  const pattern = /(?<![\p{L}\w.])LET\(/giu;
  for (let guard = 0; guard < 20; guard++) {
    const starts = [...text.matchAll(pattern)].map((m) => m.index! + m[0].length - 1);
    if (!starts.length) return text;
    const open = starts[starts.length - 1];
    const call = argumentsAt(text, open);
    if (!call || call.args.length < 3 || call.args.length % 2 === 0) return text;
    let result = call.args[call.args.length - 1];
    const pairs: [string, string][] = [];
    for (let i = 0; i < call.args.length - 1; i += 2) pairs.push([call.args[i].trim(), call.args[i + 1]]);
    if (pairs.some(([name]) => !/^[\p{L}_][\p{L}\w.]*$/u.test(name) || new RegExp(`^${CELL}$`, "u").test(name))) return text;
    const substitute = (expression: string, upTo: number) => {
      let out = expression;
      for (let i = upTo - 1; i >= 0; i--) {
        const [name, value] = pairs[i];
        const escaped = name.replace(/[.]/g, "\\.");
        out = out.replace(new RegExp(`(?<![\\p{L}\\w.$!])${escaped}(?![\\p{L}\\w.(!])`, "giu"), () => `(${substitute(value, i)})`);
        // A name bound to a LAMBDA is called like a function: f(3) → (LAMBDA(…))(3).
        if (/^\s*LAMBDA\(/i.test(value)) out = out.replace(new RegExp(`(?<![\\p{L}\\w.$!])${escaped}(?=\\()`, "giu"), () => `(${substitute(value, i)})`);
      }
      return out;
    };
    result = substitute(result, pairs.length);
    text = `${text.slice(0, open - 3)}(${result})${text.slice(call.end + 1)}`;
  }
  return text;
}

// --(…) turns TRUE/FALSE into 1/0 (the engine's minus can't take a range): 1*(…) does the same.
const rewriteDoubleMinus = (text: string) => text.replace(/(^|[(,=<>+*/^&\s])--\(/g, "$11*(");

// LAMBDA (SOTA-1). Called on the spot — LAMBDA(x,y,body)(1,2), or through a LET name — its
// parameters are replaced by the arguments in brackets (as LET does). Passed to MAP, REDUCE,
// SCAN, BYROW, BYCOL or MAKEARRAY it is kept aside and those functions work it out per value.
const LAMBDAS = new Map<string, { params: string[]; body: string }>();
const NAME = /^[\p{L}_][\p{L}\w.]*$/u;
function substituteParams(body: string, params: string[], values: string[]) {
  let out = body;
  params.forEach((name, i) => {
    const escaped = name.replace(/[.]/g, "\\.");
    out = out.replace(new RegExp(`(?<![\\p{L}\\w.$!])${escaped}(?![\\p{L}\\w.(!])`, "giu"), () => `(${values[i]})`);
  });
  return out;
}
function rewriteLambda(text: string, restore: (value: string) => string): string {
  const pattern = /(?<![\p{L}\w.])LAMBDA\(/giu;
  for (let guard = 0; guard < 50; guard++) {
    const starts = [...text.matchAll(pattern)].map((m) => m.index! + m[0].length - 1);
    if (!starts.length) return text;
    const open = starts[starts.length - 1];
    const call = argumentsAt(text, open);
    if (!call || call.args.length < 1) return text;
    const params = call.args.slice(0, -1).map((p) => p.trim());
    if (params.some((p) => !NAME.test(p) || new RegExp(`^${CELL}$`, "u").test(p))) return text;
    const body = call.args[call.args.length - 1];
    let from = open - 6;
    let to = call.end + 1;
    // (LAMBDA(…)) in brackets, as LET leaves it.
    const wrapped = text[from - 1] === "(" && text[to] === ")";
    const after = wrapped ? to + 1 : to;
    if (text[after] === "(") {
      const invoke = argumentsAt(text, after);
      if (!invoke) return text;
      const values = invoke.args.length === 1 && invoke.args[0].trim() === "" ? [] : invoke.args;
      if (values.length !== params.length) return text;
      if (wrapped) from -= 1;
      to = invoke.end + 1;
      text = `${text.slice(0, from)}(${substituteParams(body, params, values)})${text.slice(to)}`;
      continue;
    }
    const key = `__ek_lambda_${LAMBDAS.size}`;
    if (LAMBDAS.size > 5000) LAMBDAS.clear();
    LAMBDAS.set(key, { params, body: restore(body) });
    text = `${text.slice(0, from)}"${key}"${text.slice(to)}`;
  }
  return text;
}

export function rewriteFormula(formula: string) {
  if (!/[{]|ROW|COLUMN|LET|LAMBDA|--/i.test(formula)) return formula;
  const { text, restore } = protectStrings(formula);
  return restore(rewriteDoubleMinus(rewriteLambda(rewriteLet(rewriteArrays(rewriteReferences(text))), restore)));
}

// A value written back into a formula (for a LAMBDA's parameter).
function literal(value: unknown): string {
  if (Array.isArray(value)) {
    const grid = rows(value);
    return `{${grid.map((row) => row.map(literal).join(",")).join(";")}}`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value === null || value === undefined || value === "") return "0";
  return `"${String(value).replace(/"/g, '""')}"`;
}
type Parse = (formula: string) => { result: unknown; error: unknown };
function callLambda(parse: Parse, ref: unknown, values: unknown[]): Value {
  const lambda = typeof ref === "string" ? LAMBDAS.get(ref) : undefined;
  if (!lambda || lambda.params.length !== values.length) return VALUE();
  const { result, error } = parse(substituteParams(lambda.body, lambda.params, values.map(literal)));
  return (error ? new Error(String(error)) : result) as Value;
}
const LAMBDA_FUNCTIONS: Record<string, (parse: Parse, params: unknown[]) => unknown> = {
  MAP: (parse, params) => {
    const lambda = params[params.length - 1];
    const grids = params.slice(0, -1).map((p) => rows(p));
    if (!grids.length) return VALUE();
    return grids[0].map((row, i) => row.map((_, j) => callLambda(parse, lambda, grids.map((g) => g[i]?.[j] ?? null))));
  },
  REDUCE: (parse, [initial, array, lambda]) => rows(array).flat().reduce((acc, v) => callLambda(parse, lambda, [acc, v]), initial as Value),
  SCAN: (parse, [initial, array, lambda]) => {
    let acc = initial as Value;
    return rows(array).map((row) => row.map((v) => (acc = callLambda(parse, lambda, [acc, v]))));
  },
  BYROW: (parse, [array, lambda]) => rows(array).map((row) => [callLambda(parse, lambda, [[row]])]),
  BYCOL: (parse, [array, lambda]) => {
    const grid = rows(array);
    return [grid[0].map((_, j) => callLambda(parse, lambda, [grid.map((row) => [row[j]])]))];
  },
  MAKEARRAY: (parse, [height, width, lambda]) =>
    Array.from({ length: Number(height) }, (_, i) => Array.from({ length: Number(width) }, (_, j) => callLambda(parse, lambda, [i + 1, j + 1]))),
};

// Operators on ranges work cell by cell, as Excel's dynamic arrays do: A1:A4>2, A1:A4*B1:B4.
type Operators = { evaluateByOperator: (op: string, params: unknown[]) => unknown; invertNumber: (n: unknown) => unknown; __ekArrays?: boolean };
function spreadOperators(yy: Operators) {
  if (yy.__ekArrays) return;
  yy.__ekArrays = true;
  const original = yy.evaluateByOperator;
  // TRUE and FALSE count as 1 and 0 in arithmetic, as in Excel.
  const arithmetic = new Set(["+", "-", "*", "/", "^"]);
  const one = (self: unknown, op: string, params: unknown[]) => {
    try {
      return original.call(self, op, arithmetic.has(op) ? params.map((p) => (typeof p === "boolean" ? Number(p) : p)) : params);
    } catch (error) {
      return error instanceof Error ? error : VALUE();
    }
  };
  yy.evaluateByOperator = function (op, params) {
    if (!params.some(Array.isArray)) return arithmetic.has(op) && params.some((p) => typeof p === "boolean") ? one(this, op, params) : original.call(this, op, params);
    const grids = params.map((p) => rows(p));
    const height = Math.max(...grids.map((g) => g.length));
    const width = Math.max(...grids.map((g) => g[0]?.length ?? 1));
    const at = (g: Value[][], i: number, j: number) => g[g.length === 1 ? 0 : i]?.[g[0].length === 1 ? 0 : j] ?? NA();
    return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => one(this, op, grids.map((g) => at(g, i, j)))));
  };
  const invert = yy.invertNumber;
  const negate = (self: unknown, v: unknown) => invert.call(self, typeof v === "boolean" ? Number(v) : v);
  yy.invertNumber = function (n) {
    return Array.isArray(n) ? rows(n).map((row) => row.map((v) => negate(this, v))) : negate(this, n);
  };
}

let installed = false;
// Our functions answer first; everything else goes to the engine as before.
export function installSheetFunctions() {
  if (installed) return;
  installed = true;
  const proto = Parser.prototype as unknown as { getFunction: (this: { functions: Record<string, unknown> }, name: string) => unknown };
  const original = proto.getFunction;
  proto.getFunction = function (name: string) {
    const upper = String(name).toUpperCase();
    // Functions that take a LAMBDA work it out with this same parser (the cells it reads stay the same).
    const withLambda = LAMBDA_FUNCTIONS[upper];
    if (withLambda) {
      const self = this as unknown as { parse: Parse };
      return (params: unknown[]) => withLambda((formula) => self.parse(formula), params);
    }
    const fn = (EXTRA_FUNCTIONS[upper] ?? this.functions?.[name] ?? dotted(upper) ?? original.call(this, name)) as ((params: unknown[]) => unknown) | undefined;
    if (fn || !DATE_FUNCTIONS.has(upper)) return fn;
    // formula.js gives dates as JavaScript dates: shown as Excel shows them (a date in the cell).
    const builtin = (formulajs as unknown as Record<string, unknown>)[upper] as ((...args: unknown[]) => unknown) | undefined;
    return builtin ? (params: unknown[]) => asExcelDate(builtin(...params)) : undefined;
  };
  // Package 4: array literals, ROW/COLUMN of a reference, LET; operators on ranges.
  // The editor passes the cell being calculated after the formula: it goes on unchanged.
  const parsing = Parser.prototype as unknown as { parse: (this: { parser?: { yy?: Operators } }, formula: string, ...rest: unknown[]) => unknown };
  const originalParse = parsing.parse;
  parsing.parse = function (formula: string, ...rest: unknown[]) {
    if (this.parser?.yy) spreadOperators(this.parser.yy);
    return originalParse.call(this, typeof formula === "string" ? rewriteFormula(formula) : formula, ...rest);
  };
  // TRUE and FALSE written as words, as in Excel (the engine reads them as cell addresses).
  const cells = Parser.prototype as unknown as { _callCellValue: (this: unknown, label: string) => unknown };
  const originalCell = cells._callCellValue;
  cells._callCellValue = function (label: string) {
    const upper = String(label).toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    return originalCell.call(this, label);
  };
}
