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

let installed = false;
// Our functions answer first; everything else goes to the engine as before.
export function installSheetFunctions() {
  if (installed) return;
  installed = true;
  const proto = Parser.prototype as unknown as { getFunction: (this: { functions: Record<string, unknown> }, name: string) => unknown };
  const original = proto.getFunction;
  proto.getFunction = function (name: string) {
    const upper = String(name).toUpperCase();
    const fn = (EXTRA_FUNCTIONS[upper] ?? this.functions?.[name] ?? dotted(upper) ?? original.call(this, name)) as ((params: unknown[]) => unknown) | undefined;
    if (fn || !DATE_FUNCTIONS.has(upper)) return fn;
    // formula.js gives dates as JavaScript dates: shown as Excel shows them (a date in the cell).
    const builtin = (formulajs as unknown as Record<string, unknown>)[upper] as ((...args: unknown[]) => unknown) | undefined;
    return builtin ? (params: unknown[]) => asExcelDate(builtin(...params)) : undefined;
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
