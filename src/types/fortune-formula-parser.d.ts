// The table editor's formula engine (MIT) ships without types; we only touch
// how it looks up functions (src/lib/sheet-functions.ts).
declare module "@fortune-sheet/formula-parser" {
  export class Parser {
    functions: Record<string, unknown>;
    getFunction(name: string): unknown;
    setFunction(name: string, fn: (params: unknown[]) => unknown): this;
  }
}

// formula.js (MIT), the functions behind the engine; read only for Excel's dotted names.
declare module "@formulajs/formulajs";
