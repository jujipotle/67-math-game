import { Rational, Op } from "./types";
import { eq, rat, add, sub, mul, div } from "./rational";

type Item = {
  value: Rational;
  expr: string;
};

const OPS: Op[] = ["+", "-", "*", "/"];

const OP_SYMBOLS: Record<Op, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

type AST =
  | { type: "num"; val: string }
  | { type: "bin"; op: Op; left: AST; right: AST };

function parseExpr(s: string): AST | null {
  s = s.trim();
  if (/^\d+$/.test(s)) return { type: "num", val: s };
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1);
    let depth = 0;
    let bestIdx = -1;
    let bestOp: Op | null = null;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth === 0 && ["+", "-", "*", "/"].includes(c)) {
        const prev = inner[i - 1];
        const next = inner[i + 1];
        if (prev && /[\s)]/.test(prev) && next && /[\s(]/.test(next)) {
          bestIdx = i;
          bestOp = c as Op;
        }
      }
    }
    if (bestIdx >= 0 && bestOp) {
      const left = parseExpr(inner.slice(0, bestIdx).trim());
      const right = parseExpr(inner.slice(bestIdx + 1).trim());
      if (left && right) return { type: "bin", op: bestOp, left, right };
    }
  }
  return null;
}

function evalAst(ast: AST): Rational | null {
  if (ast.type === "num") return rat(parseInt(ast.val, 10));
  const { op, left, right } = ast;
  const l = evalAst(left);
  const r = evalAst(right);
  if (l === null || r === null) return null;
  if (op === "+") return add(l, r);
  if (op === "-") return sub(l, r);
  if (op === "*") return mul(l, r);
  if (op === "/") return div(l, r);
  return null;
}

/** Apply equivalence transforms per theory. Preference: fewer brackets, less nesting, ×1 over /1. */
function normalize(ast: AST): AST {
  if (ast.type === "num") return ast;
  const { op, left, right } = ast;
  const nl = normalize(left);
  const nr = normalize(right);
  const rv = evalAst(nr);

  if (op === "-" && nr.type === "bin" && nr.op === "-") {
    return normalize({ type: "bin", op: "+", left: nl, right: { type: "bin", op: "-", left: nr.right, right: nr.left } });
  }
  if (op === "-" && nr.type === "bin" && (nr.op === "*" || nr.op === "/")) {
    const inner = nr as { type: "bin"; op: Op; left: AST; right: AST };
    if (inner.right.type === "bin" && inner.right.op === "-") {
      const c = inner.right.left;
      const b = inner.right.right;
      const cb = { type: "bin" as const, op: "-" as const, left: c, right: b };
      const neg = inner.op === "*" ? { type: "bin" as const, op: "*" as const, left: cb, right: inner.left } : { type: "bin" as const, op: "/" as const, left: cb, right: inner.left };
      return normalize({ type: "bin", op: "+", left: nl, right: neg });
    }
    if (inner.left.type === "bin" && inner.left.op === "-") {
      const b = inner.left.left;
      const c = inner.left.right;
      const cb = { type: "bin" as const, op: "-" as const, left: c, right: b };
      const neg = inner.op === "*" ? { type: "bin" as const, op: "*" as const, left: cb, right: inner.right } : { type: "bin" as const, op: "/" as const, left: cb, right: inner.right };
      return normalize({ type: "bin", op: "+", left: nl, right: neg });
    }
    if (inner.op === "*") {
      const lv = evalAst(inner.left);
      const rv = evalAst(inner.right);
      if (rv !== null && rv.n < 0n) {
        const negRight = normalize({ type: "bin", op: "-", left: { type: "num", val: "0" }, right: inner.right });
        return normalize({ type: "bin", op: "+", left: nl, right: { type: "bin", op: "*", left: inner.left, right: negRight } });
      }
      if (lv !== null && lv.n < 0n) {
        const negLeft = normalize({ type: "bin", op: "-", left: { type: "num", val: "0" }, right: inner.left });
        return normalize({ type: "bin", op: "+", left: nl, right: { type: "bin", op: "*", left: negLeft, right: inner.right } });
      }
    }
  }
  if (op === "/" && nr.type === "bin" && nr.op === "/") {
    return normalize({ type: "bin", op: "*", left: nl, right: { type: "bin", op: "/", left: nr.right, right: nr.left } });
  }
  if (op === "/" && nr.type === "bin" && nr.op === "*") {
    return normalize({ type: "bin", op: "/", left: { type: "bin", op: "/", left: nl, right: nr.left }, right: nr.right });
  }
  if (op === "/" && rv !== null && eq(rv, rat(1))) {
    return normalize({ type: "bin", op: "*", left: nl, right: nr });
  }
  if (op === "*" && rv !== null && eq(rv, rat(1))) {
    return nl;
  }
  if (op === "*") {
    const lv = evalAst(nl);
    const rvInner = evalAst(nr);
    if (nl.type === "bin" && nl.op === "-" && lv !== null && lv.n < 0n) {
      return normalize({ type: "bin", op: "*", left: { type: "bin", op: "-", left: nl.right, right: nl.left }, right: nr });
    }
    if (nr.type === "bin" && nr.op === "-" && rvInner !== null && rvInner.n < 0n) {
      return normalize({ type: "bin", op: "*", left: nl, right: { type: "bin", op: "-", left: nr.right, right: nr.left } });
    }
  }
  if (op === "*" && nr.type === "bin" && nr.op === "/") {
    return normalize({ type: "bin", op: "/", left: { type: "bin", op: "*", left: nl, right: nr.left }, right: nr.right });
  }
  if (op === "*" && nl.type === "bin" && nl.op === "/") {
    return normalize({ type: "bin", op: "/", left: { type: "bin", op: "*", left: nl.left, right: nr }, right: nl.right });
  }

  return { type: "bin", op, left: nl, right: nr };
}

/** Preference: complex on left (0), then bigger numbers first. Rule 5 tie-breaker. */
function termKey(t: AST): string {
  const v = evalAst(t);
  const num = v && v.d === 1n && v.n >= 0n && v.n <= 10000n ? Number(v.n) : 0;
  const complex = t.type === "bin" ? "0" : "1";
  return `${complex}-${String(100000 - num).padStart(5, "0")}`;
}

/** Flatten to signed terms for canonical sum: a + b - c - d → [{+a},{+b},{-c},{-d}] */
function flattenToSignedTerms(ast: AST): { sign: number; ast: AST }[] {
  if (ast.type === "num") return [{ sign: 1, ast }];
  if (ast.type === "bin" && ast.op === "+") {
    return [...flattenToSignedTerms(ast.left), ...flattenToSignedTerms(ast.right)];
  }
  if (ast.type === "bin" && ast.op === "-") {
    const negated = flattenToSignedTerms(ast.right).map(({ sign, ast: t }) => ({ sign: -sign, ast: t }));
    return [...flattenToSignedTerms(ast.left), ...negated];
  }
  return [{ sign: 1, ast }];
}

function canonicalize(ast: AST, isRoot: boolean): string {
  if (ast.type === "num") return ast.val;
  const v = evalAst(ast);
  if (!isRoot && v !== null && v.d === 1n && v.n >= 0n && v.n <= 10000n) {
    return v.n.toString();
  }
  const { op, left, right } = ast;

  if (op === "+" || op === "-") {
    const terms = flattenToSignedTerms(ast);
    const byKey = new Map<string, { pos: number; neg: number; ast: AST }>();
    for (const { sign, ast: t } of terms) {
      const k = canonicalize(t, false);
      const entry = byKey.get(k) ?? { pos: 0, neg: 0, ast: t };
      if (sign > 0) entry.pos++;
      else entry.neg++;
      byKey.set(k, entry);
    }
    const entries = Array.from(byKey.entries())
      .filter(([, e]) => e.pos !== e.neg)
      .map(([s, e]) => ({ s, ...e, key: termKey(e.ast), net: e.pos - e.neg }))
      .sort((a, b) => {
        if (a.net > 0 !== b.net > 0) return a.net > 0 ? -1 : 1;
        return a.key.localeCompare(b.key);
      });
    const positive: string[] = [];
    const negative: string[] = [];
    for (const { s, net, ast: t } of entries) {
      const wrapped = t.type === "bin" && (t.op === "+" || t.op === "-") ? `(${s})` : s;
      for (let i = 0; i < net; i++) positive.push(wrapped);
      for (let i = 0; i < -net; i++) negative.push(wrapped);
    }
    const pos = positive.join(" + ");
    const neg = negative.join(" - ");
    return neg ? (pos ? `${pos} - ${neg}` : `-${neg}`) : pos || "0";
  }
  if (op === "*") {
    const terms = flattenTimes(ast);
    const sorted = terms.map((t) => ({ ast: t, key: termKey(t) })).sort((a, b) => a.key.localeCompare(b.key));
    const inner = sorted.map(({ ast: t }) => canonicalize(t, false)).join(" * ");
    return terms.length > 1 ? `(${inner})` : inner;
  }
  if (op === "/") {
    const nums = flattenDivide(ast);
    const sorted = nums.map((t) => ({ ast: t, key: termKey(t) })).sort((a, b) => a.key.localeCompare(b.key));
    return sorted
      .map(({ ast: t }) => {
        const s = canonicalize(t, false);
        return t.type === "bin" && (t.op === "+" || t.op === "-") ? `(${s})` : s;
      })
      .join(" / ");
  }
  return "";
}

function flattenTimes(ast: AST): AST[] {
  if (ast.type === "num") return [ast];
  if (ast.type === "bin" && ast.op === "*") {
    return [...flattenTimes(ast.left), ...flattenTimes(ast.right)];
  }
  return [ast];
}

function flattenDivide(ast: AST): AST[] {
  if (ast.type === "bin" && ast.op === "/") {
    const leftTerms = ast.left.type === "bin" && ast.left.op === "/" ? flattenDivide(ast.left) : [ast.left];
    return [...leftTerms, ast.right];
  }
  return [ast];
}

export function solve(numbers: number[], goal: number): string[] {
  const target = rat(goal);
  const seen = new Map<string, string>();
  const items: Item[] = numbers.map((n) => ({
    value: rat(n),
    expr: n.toString(),
  }));

  search(items, target, seen);
  return Array.from(seen.values());
}

/** Prefer displays per theory: fewer subtract-of-parens, ×1 over ÷1 (rule 6), then shorter. */
function preferDisplay(candidate: string, existing: string): boolean {
  const subParen = (x: string) => (x.match(/[−\-]\s*\(/g) ?? []).length;
  const divBy1 = (x: string) => (x.match(/[÷\/]\s*1\b/g) ?? []).length;
  if (subParen(candidate) < subParen(existing)) return true;
  if (subParen(candidate) > subParen(existing)) return false;
  if (divBy1(candidate) < divBy1(existing)) return true;
  if (divBy1(candidate) > divBy1(existing)) return false;
  return candidate.length <= existing.length;
}

function search(items: Item[], target: Rational, seen: Map<string, string>): void {
  if (items.length === 1) {
    if (eq(items[0].value, target)) {
      const expr = items[0].expr;
      const s = expr.replace(/[−×÷]/g, (c) => ({ "−": "-", "×": "*", "÷": "/" }[c]!));
      const parsed = parseExpr(s);
      if (parsed === null) return;
      const normalized = normalize(parsed);
      const key = canonicalize(normalized, true);
      const display = minimizeParens(expr);
      const existing = seen.get(key);
      if (existing && !preferDisplay(display, existing)) return;
      seen.set(key, display);
    }
    return;
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const rest = items.filter((_, idx) => idx !== i && idx !== j);

      for (const op of OPS) {
        const results = combine(a, b, op);
        for (const result of results) {
          search([...rest, result], target, seen);
        }
      }
    }
  }
}

function combine(a: Item, b: Item, op: Op): Item[] {
  const sym = OP_SYMBOLS[op];
  const results: Item[] = [];

  switch (op) {
    case "+":
      results.push({ value: add(a.value, b.value), expr: `(${a.expr} ${sym} ${b.expr})` });
      break;
    case "*":
      results.push({ value: mul(a.value, b.value), expr: `(${a.expr} ${sym} ${b.expr})` });
      break;
    case "-":
      results.push({ value: sub(a.value, b.value), expr: `(${a.expr} ${sym} ${b.expr})` });
      results.push({ value: sub(b.value, a.value), expr: `(${b.expr} ${sym} ${a.expr})` });
      break;
    case "/":
      if (b.value.n !== 0n) results.push({ value: div(a.value, b.value)!, expr: `(${a.expr} ${sym} ${b.expr})` });
      if (a.value.n !== 0n) results.push({ value: div(b.value, a.value)!, expr: `(${b.expr} ${sym} ${a.expr})` });
      break;
  }

  return results;
}

/** Remove unnecessary parentheses for readability. */
export function minimizeParens(expr: string): string {
  const s = expr.replace(/[−×÷]/g, (c) => ({ "−": "-", "×": "*", "÷": "/" }[c]!));
  const parsed = parseExpr(s);
  if (parsed === null) return expr;
  const out = formatMinimal(parsed, null);
  return out.replace(/[*]/g, "×").replace(/[/]/g, "÷").replace(/-/g, "−");
}

function needsParens(childOp: Op, parentOp: Op | null, isRight: boolean): boolean {
  if (parentOp === null) return false;
  const hi: Op[] = ["*", "/"];
  const lo: Op[] = ["+", "-"];
  if (lo.includes(parentOp) && hi.includes(childOp)) return false;
  if (hi.includes(parentOp) && lo.includes(childOp)) return true;
  if (parentOp === "-" && isRight && lo.includes(childOp)) return true;
  if (parentOp === "+" && isRight && lo.includes(childOp)) return true;
  if (parentOp === "/" && isRight && hi.includes(childOp)) return true;
  return false;
}

function formatMinimal(ast: AST, parentOp: Op | null, isRight = false): string {
  if (ast.type === "num") return ast.val;
  const { op, left, right } = ast;
  const lp = formatMinimal(left, op, false);
  const rp = formatMinimal(right, op, true);
  const inner = `${lp} ${op} ${rp}`;
  return needsParens(op, parentOp, isRight) ? `(${inner})` : inner;
}

export function hasSolution(numbers: number[], goal: number): boolean {
  const target = rat(goal);
  const items: Item[] = numbers.map((n) => ({
    value: rat(n),
    expr: n.toString(),
  }));
  return searchEarly(items, target);
}

function normalizeOpsToAscii(expr: string): string {
  return expr.replace(/[−×÷]/g, (c) => ({ "−": "-", "×": "*", "÷": "/" }[c]!));
}

function collectNums(ast: AST, out: number[]): void {
  if (ast.type === "num") {
    out.push(parseInt(ast.val, 10));
    return;
  }
  collectNums(ast.left, out);
  collectNums(ast.right, out);
}

/** Validate that `expr` uses exactly `cards` once each and equals `goal`. */
export function validateFinalExpr(expr: string, cards: number[], goal: number): boolean {
  try {
    const s = normalizeOpsToAscii(expr);
    const ast = parseExpr(s);
    if (ast === null) return false;
    const value = evalAst(ast);
    if (value === null) return false;

    const used: number[] = [];
    collectNums(ast, used);
    if (used.length !== cards.length) return false;
    used.sort((a, b) => a - b);
    const want = [...cards].sort((a, b) => a - b);
    for (let i = 0; i < want.length; i++) {
      if (used[i] !== want[i]) return false;
    }

    return eq(value, rat(goal));
  } catch {
    return false;
  }
}

function searchEarly(items: Item[], target: Rational): boolean {
  if (items.length === 1) return eq(items[0].value, target);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const rest = items.filter((_, idx) => idx !== i && idx !== j);

      for (const op of OPS) {
        const results = combine(a, b, op);
        for (const result of results) {
          if (searchEarly([...rest, result], target)) return true;
        }
      }
    }
  }
  return false;
}
