// Table formulas against the results Excel gives (package 4 and a few older ones
// as a guard). Run: node --experimental-strip-types --no-warnings scripts/test-sheet-formulas.mjs
import { createRequire } from "node:module";
import { installSheetFunctions } from "../src/lib/sheet-functions.ts";

const { Parser } = createRequire(import.meta.url)("@fortune-sheet/formula-parser");
installSheetFunctions();

// A1:A5 = 3 1 3 2 5, B1:B5 = b a b c e, C1 = 10.
const grid = [
  [3, "b", 10],
  [1, "a"],
  [3, "b"],
  [2, "c"],
  [5, "e"],
];
const parser = new Parser();
parser.on("callCellValue", (c, _sheet, done) => done(grid[c.row.index]?.[c.column.index] ?? null));
parser.on("callRangeValue", (a, b, _sheet, done) => {
  const out = [];
  for (let i = a.row.index; i <= b.row.index; i++) {
    const row = [];
    for (let j = a.column.index; j <= b.column.index; j++) row.push(grid[i]?.[j] ?? null);
    out.push(row);
  }
  done(out);
});

const CASES = [
  // ROW / COLUMN / ROWS / COLUMNS of a reference.
  ["ROW(A5)", 5],
  ["COLUMN(C1)", 3],
  ["ROW($B$7)", 7],
  ["ROWS(A1:A5)", 5],
  ["COLUMNS(A1:C1)", 3],
  ["ROW(A2:A4)+COLUMN(B3)", 4],
  ["INDEX(A1:A5,ROWS(A1:A3))", 3],
  // Array literals.
  ["SUM({1,2,3})", 6],
  ["SUM({1,2;3,4})", 10],
  ['VLOOKUP(2,{1,"a";2,"b"},2,FALSE)', "b"],
  ["MAX({4,9,2})", 9],
  ['COUNTA({"x","y"})', 2],
  // Operators on ranges, and functions that take them.
  ["SUM(A1:A5*2)", 28],
  ["SUMPRODUCT(--(A1:A5>2))", 3],
  ["SUMPRODUCT({0;0;1;1;0})", 2],
  ["2*--(C1>5)", 2],
  ["SUM((A1:A5>2)*A1:A5)", 11],
  // FILTER / SORT / SORTBY / UNIQUE / SEQUENCE / TRANSPOSE inside other formulas.
  ["SUM(FILTER(A1:A5,A1:A5>2))", 11],
  ['COUNTA(FILTER(B1:B5,A1:A5=3))', 2],
  ['FILTER(A1:A5,A1:A5>100,"none")', "none"],
  ["INDEX(SORT(A1:A5),1)", 1],
  ["INDEX(SORT(A1:A5,1,-1),1)", 5],
  ["INDEX(SORTBY(B1:B5,A1:A5,-1),1)", "e"],
  ["COUNTA(UNIQUE(B1:B5))", 4],
  ["SUM(UNIQUE(A1:A5))", 11],
  ["COUNTA(UNIQUE(A1:A5,FALSE,TRUE))", 3],
  ["SUM(SEQUENCE(4))", 10],
  ["INDEX(SEQUENCE(2,3,10,5),2,1)", 25],
  ["SUM(TRANSPOSE(A1:A5))", 14],
  // LET.
  ["LET(x,2,x*3)", 6],
  ["LET(price,C1*1.2,price+5)", 17],
  ["LET(ціна,C1,кількість,3,ціна*кількість)", 30],
  ["LET(a,1,b,a+1,LET(c,b*10,c+a))", 21],
  ['LET(x,"x",x&"y")', "xy"],
  // LAMBDA (SOTA-1): on the spot, through LET, and in MAP / REDUCE / SCAN / BYROW / BYCOL / MAKEARRAY.
  ["LAMBDA(x,x*2)(21)", 42],
  ["LAMBDA(a,b,a+b)(2,3)", 5],
  ["LET(double,LAMBDA(x,x*2),double(5)+1)", 11],
  ["LET(f,LAMBDA(x,y,x*y),f(3,4)+f(1,2))", 14],
  ['LAMBDA(s,s&"!")("hi")', "hi!"],
  ["SUM(MAP(A1:A5,LAMBDA(v,v*10)))", 140],
  ["REDUCE(0,A1:A5,LAMBDA(acc,v,acc+v))", 14],
  ["REDUCE(1,{1,2,3,4},LAMBDA(p,v,p*v))", 24],
  ["INDEX(SCAN(0,A1:A5,LAMBDA(acc,v,acc+v)),5,1)", 14],
  ["SUM(BYROW({1,2;3,4},LAMBDA(r,SUM(r))))", 10],
  ["INDEX(BYCOL({1,2;3,4},LAMBDA(c,MAX(c))),1,2)", 4],
  ["SUM(MAKEARRAY(2,3,LAMBDA(r,c,r*c)))", 18],
  ['COUNTA(MAP(B1:B5,LAMBDA(t,t&"x")))', 5],
  // Older formulas keep working.
  ["SUM(A1:A5)", 14],
  ['COUNTIF(B1:B5,"b")', 2],
  ['IF(C1>5,"big","small")', "big"],
  ['"ROW(A5)"&"{1}"', "ROW(A5){1}"],
];

let failed = 0;
for (const [formula, expected] of CASES) {
  const { result, error } = parser.parse(formula);
  const got = error ?? result;
  const ok = typeof expected === "number" ? Math.abs(Number(got) - expected) < 1e-9 : got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} =${formula} → ${JSON.stringify(got)}${ok ? "" : ` (Excel: ${JSON.stringify(expected)})`}`);
}
console.log(`${CASES.length - failed}/${CASES.length} as in Excel`);
process.exit(failed ? 1 : 0);
