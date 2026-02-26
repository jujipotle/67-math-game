import { Rational, Op } from "./types";
import { eq, rat, add, sub, mul, div, compare, gt, ratToNumber } from "./rational";

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
  const findTopLevelOp = (str: string): { idx: number; op: Op } | null => {
    let depth = 0;
    let addSubIdx = -1;
    let addSubOp: Op | null = null;
    let mulDivIdx = -1;
    let mulDivOp: Op | null = null;
    const ok = (prev: string | undefined, next: string | undefined) =>
      prev !== undefined && /[\s)\d]/.test(prev) && next !== undefined && /[\s(\d]/.test(next);
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth === 0 && ["+", "-", "*", "/"].includes(c)) {
        const prev = str[i - 1];
        const next = str[i + 1];
        if (ok(prev, next)) {
          if (c === "+" || c === "-") {
            addSubIdx = i;
            addSubOp = c as Op;
          } else {
            mulDivIdx = i;
            mulDivOp = c as Op;
          }
        }
      }
    }
    const rightmost = (idx: number, op: Op | null) => (op !== null ? { idx, op } : null);
    if (addSubIdx >= 0 && addSubOp) return rightmost(addSubIdx, addSubOp);
    if (mulDivIdx >= 0 && mulDivOp) return rightmost(mulDivIdx, mulDivOp);
    return null;
  };
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1);
    const match = findTopLevelOp(inner);
    if (match) {
      const left = parseExpr(inner.slice(0, match.idx).trim());
      const right = parseExpr(inner.slice(match.idx + 1).trim());
      if (left && right) return { type: "bin", op: match.op, left, right };
    }
  }
  const match = findTopLevelOp(s);
  if (match) {
    const left = parseExpr(s.slice(0, match.idx).trim());
    const right = parseExpr(s.slice(match.idx + 1).trim());
    if (left && right) return { type: "bin", op: match.op, left, right };
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
      const rightAdditive = inner.right.type === "bin" && (inner.right.op === "+" || inner.right.op === "-");
      const leftAdditive = inner.left.type === "bin" && (inner.left.op === "+" || inner.left.op === "-");
      if (rv !== null && rv.n < 0n) {
        const posRight = rightAdditive ? positiveFormAdditive(inner.right) : normalize({ type: "bin", op: "-", left: { type: "num", val: "0" }, right: inner.right });
        return normalize({ type: "bin", op: "+", left: nl, right: { type: "bin", op: "*", left: inner.left, right: posRight } });
      }
      if (lv !== null && lv.n < 0n) {
        const posLeft = leftAdditive ? positiveFormAdditive(inner.left) : normalize({ type: "bin", op: "-", left: { type: "num", val: "0" }, right: inner.left });
        return normalize({ type: "bin", op: "+", left: nl, right: { type: "bin", op: "*", left: posLeft, right: inner.right } });
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
  if (op === "/" && nl.type === "num" && nl.val === "0") {
    return normalize({ type: "bin", op: "*", left: nl, right: nr });
  }
  if (op === "*") {
    const lv = evalAst(nl);
    const rvInner = evalAst(nr);
    if (nl.type === "bin" && nl.op === "-" && lv !== null && lv.n < 0n) {
      return normalize({ type: "bin", op: "*", left: { type: "bin", op: "-", left: nl.right, right: nl.left }, right: nr });
    }
    // Do NOT flip a single negative factor (e.g. 2×8×(3-10) must stay -112); that would change the value.
    // Only flip when both factors are negative: (3-5)×(1-2) → (5-3)×(2-1).
    // (3-5)×(1-2) → (5-3)×(2-1): no negative inside parentheses
    if (
      nl.type === "bin" &&
      nl.op === "-" &&
      nr.type === "bin" &&
      nr.op === "-" &&
      lv !== null &&
      lv.n < 0n &&
      rvInner !== null &&
      rvInner.n < 0n
    ) {
      return normalize({
        type: "bin",
        op: "*",
        left: { type: "bin", op: "-", left: nl.right, right: nl.left },
        right: { type: "bin", op: "-", left: nr.right, right: nr.left },
      });
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

/** First number in AST (leftmost leaf) for tie-breaking e.g. (7×2+1) vs (3×3+6) → 7 vs 3. */
function firstNumber(ast: AST): number {
  if (ast.type === "num") return parseInt(ast.val, 10);
  return firstNumber(ast.left);
}

/** Leftmost number in infix order (for PEMDAS tie-breaker). */
function firstNumberIn(ast: AST): number {
  if (ast.type === "num") return parseInt(ast.val, 10);
  return firstNumberIn(ast.left);
}

/** Absolute magnitude for ordering (integer when possible). */
function absMagnitude(ast: AST): number {
  const v = evalAst(ast);
  if (v === null) return 0;
  const n = Number(v.n);
  const d = Number(v.d);
  return Math.abs(n / d);
}

/** True if node is additive (+, −) and will be shown in parens when used as factor. */
function isAdditive(ast: AST): boolean {
  return ast.type === "bin" && (ast.op === "+" || ast.op === "-");
}

/** True if node is division (for "division before addition" inside parens). */
function isDivision(ast: AST): boolean {
  return ast.type === "bin" && ast.op === "/";
}

/** PEMDAS display: × ÷ first, then + −; factors ordered parens-first, then magnitude, then first number; no negative inside parens. */
function formatPemdas(ast: AST, inMulContext: boolean): string {
  if (ast.type === "num") return ast.val;

  const { op, left, right } = ast;
  const val = evalAst(ast);

  if (op === "*") {
    const factors = flattenTimes(ast);
    const sorted = factors
      .map((t) => ({
        ast: t,
        isParen: isAdditive(t),
        mag: absMagnitude(t),
        first: firstNumberIn(t),
      }))
      .sort((a, b) => {
        if (a.isParen !== b.isParen) return a.isParen ? -1 : 1;
        if (a.mag !== b.mag) return b.mag - a.mag;
        return b.first - a.first;
      });
    const parts = sorted.map(({ ast: t }) => formatPemdas(t, true));
    return parts.join(" × ");
  }

  if (op === "/") {
    const terms = flattenDivide(ast);
    const sorted = terms
      .map((t) => ({
        ast: t,
        isParen: isAdditive(t),
        mag: absMagnitude(t),
        first: firstNumberIn(t),
      }))
      .sort((a, b) => {
        if (a.isParen !== b.isParen) return a.isParen ? -1 : 1;
        if (a.mag !== b.mag) return b.mag - a.mag;
        return b.first - a.first;
      });
    const parts = sorted.map(({ ast: t }) => formatPemdas(t, true));
    return parts.join(" / ");
  }

  if (op === "+" || op === "-") {
    const terms = flattenToSignedTerms(ast);
    const positive = terms.filter((t) => t.sign > 0).map((t) => t.ast);
    const negative = terms.filter((t) => t.sign < 0).map((t) => t.ast);

    const sortTerm = (a: AST, b: AST) => {
      const productA = a.type === "bin" && (a.op === "*" || a.op === "/") ? 0 : 1;
      const productB = b.type === "bin" && (b.op === "*" || b.op === "/") ? 0 : 1;
      if (productA !== productB) return productA - productB;
      const divA = isDivision(a) ? 0 : 1;
      const divB = isDivision(b) ? 0 : 1;
      if (divA !== divB) return divA - divB;
      return absMagnitude(b) - absMagnitude(a);
    };
    positive.sort(sortTerm);
    negative.sort(sortTerm);

    const fmtTerm = (t: AST): string => {
      const inner = formatPemdasTerm(t);
      if (inMulContext && isAdditive(t)) return `(${inner})`;
      if (t.type === "bin" && (t.op === "*" || t.op === "/")) return inner;
      return inner;
    };

    const posStr = positive.map(fmtTerm).join(" + ");
    const negPart = negative.map((t) => " − " + fmtTerm(t)).join("");
    const out = posStr ? (negPart ? `${posStr}${negPart}` : posStr) : (negPart ? negPart.slice(1) : "0");
    return inMulContext ? `(${out})` : out;
  }

  return "";
}

function wrapAdditive(ast: AST): string {
  const s = formatPemdas(ast, false);
  return isAdditive(ast) ? `(${s})` : s;
}

/** Format a single term; for subtraction ensure (big − small) so paren content is never negative. */
function formatPemdasTerm(ast: AST): string {
  if (ast.type === "num") return ast.val;
  if (ast.type === "bin" && ast.op === "-") {
    const v = evalAst(ast);
    if (v !== null && v.n < 0n) {
      return `${wrapAdditive(ast.right)} − ${wrapAdditive(ast.left)}`;
    }
  }
  return formatPemdas(ast, false);
}

/** Build left-associative sum tree from ASTs. */
function makeSumTree(asts: AST[]): AST {
  if (asts.length === 0) return { type: "num", val: "0" };
  if (asts.length === 1) return asts[0]!;
  return { type: "bin", op: "+", left: makeSumTree(asts.slice(0, -1)), right: asts[asts.length - 1]! };
}

/** For additive AST with negative value, return AST for positive form e.g. (6-11-7) → (11+7-6). */
function positiveFormAdditive(ast: AST): AST {
  if (ast.type !== "bin" || (ast.op !== "+" && ast.op !== "-")) return ast;
  const terms = flattenToSignedTerms(ast);
  const val = evalAst(ast);
  if (val === null || val.n >= 0n) return ast;
  const pos = terms.filter((t) => t.sign > 0).map((t) => t.ast);
  const neg = terms.filter((t) => t.sign < 0).map((t) => t.ast);
  const left = makeSumTree(neg);
  const right = makeSumTree(pos);
  return normalize({ type: "bin", op: "-", left, right });
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

/** Strip ×1 factors from products so expr, expr×1, 1×expr get the same canonical key. */
function stripTrailingOnes(ast: AST): AST {
  if (ast.type === "num") return ast;
  if (ast.type === "bin" && ast.op === "*") {
    const l = stripTrailingOnes(ast.left);
    const r = stripTrailingOnes(ast.right);
    if (l.type === "num" && l.val === "1") return stripTrailingOnes(ast.right);
    if (r.type === "num" && r.val === "1") return stripTrailingOnes(ast.left);
    return { type: "bin", op: "*", left: l, right: r };
  }
  return {
    type: "bin",
    op: ast.op,
    left: stripTrailingOnes(ast.left),
    right: stripTrailingOnes(ast.right),
  };
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

/** AST needs parentheses when used as a factor in * or / (P in PEMDAS: parens on left). */
function isCompoundFactor(ast: AST): boolean {
  if (ast.type === "num") return false;
  return ast.op === "+" || ast.op === "-" || ast.op === "/";
}

/** Fully flatten additive to signed terms, expanding nested +/− so we can sort at one level. */
function flattenAdditiveToSignedTerms(ast: AST): { sign: number; ast: AST }[] {
  const raw = flattenToSignedTerms(ast);
  const out: { sign: number; ast: AST }[] = [];
  for (const { sign, ast: t } of raw) {
    if (t.type === "bin" && (t.op === "+" || t.op === "-")) {
      const sub = flattenAdditiveToSignedTerms(t).map(({ sign: s, ast: a }) => ({ sign: sign * s, ast: a }));
      out.push(...sub);
    } else {
      out.push({ sign, ast: t });
    }
  }
  return out;
}

/** Format additive subexpression (inside parens used as factor): division, then mult, then by magnitude desc. */
function formatAdditiveForFactor(ast: AST): string {
  if (ast.type === "num") return ast.val;
  if (ast.type === "bin" && (ast.op === "+" || ast.op === "-")) {
    const terms = flattenAdditiveToSignedTerms(ast);
    type T = { sign: number; ast: AST; val: Rational | null; isDiv: boolean; isMult: boolean };
    const withMeta: T[] = terms.map(({ sign, ast: t }) => ({
      sign,
      ast: t,
      val: evalAst(t),
      isDiv: t.type === "bin" && t.op === "/",
      isMult: t.type === "bin" && t.op === "*",
    }));
    withMeta.sort((a, b) => {
      if (a.sign !== b.sign) return a.sign > 0 ? -1 : 1;
      if (a.isDiv !== b.isDiv) return a.isDiv ? -1 : 1;
      if (a.isMult !== b.isMult) return a.isMult ? -1 : 1;
      const va = a.val;
      const vb = b.val;
      if (va === null || vb === null) return 0;
      return -compare(va, vb);
    });
    const posParts: string[] = [];
    const negParts: string[] = [];
    for (let i = 0; i < withMeta.length; i++) {
      const { sign, ast: t } = withMeta[i];
      const s = formatFactorInProduct(t);
      if (sign > 0) posParts.push(s);
      else negParts.push(s);
    }
    const pos = posParts.join(" + ");
    const neg = negParts.join(" - ");
    return neg ? (pos ? `${pos} - ${neg}` : `-${neg}`) : pos || "0";
  }
  return formatFactorInProduct(ast);
}

/** Format a single factor inside a product: (a-b) with negative value → (b-a). */
function formatFactorInProduct(ast: AST): string {
  if (ast.type === "num") return ast.val;
  const v = evalAst(ast);
  if (ast.type === "bin" && ast.op === "-" && v !== null && v.n < 0n) {
    return `(${formatAdditiveForFactor(ast.right)} - ${formatAdditiveForFactor(ast.left)})`;
  }
  if (ast.type === "bin" && (ast.op === "+" || ast.op === "-")) {
    return `(${formatAdditiveForFactor(ast)})`;
  }
  if (ast.type === "bin" && ast.op === "/") {
    const nums = flattenDivide(ast);
    const sorted = nums.map((t) => ({ ast: t, key: termKey(t) })).sort((a, b) => a.key.localeCompare(b.key));
    return sorted
      .map(({ ast: t }) => {
        const s = t.type === "bin" && (t.op === "+" || t.op === "-") ? `(${formatAdditiveForFactor(t)})` : formatFactorInProduct(t);
        return s;
      })
      .join(" / ");
  }
  if (ast.type === "bin" && ast.op === "*") {
    const terms = flattenTimes(ast);
    const sorted = sortFactorsForDisplay(terms);
    return sorted.map((t) => formatFactorInProduct(t)).join(" * ");
  }
  return "";
}

/** Sort factors: compound (parens) first, then by value desc, then firstNumber desc. */
function sortFactorsForDisplay(factors: AST[]): AST[] {
  return [...factors].sort((a, b) => {
    const ac = isCompoundFactor(a);
    const bc = isCompoundFactor(b);
    if (ac !== bc) return ac ? -1 : 1;
    const va = evalAst(a);
    const vb = evalAst(b);
    if (va !== null && vb !== null) {
      const c = compare(va, vb);
      if (c !== 0) return -c;
    }
    return firstNumber(b) - firstNumber(a);
  });
}

/** Format a product for display (factors sorted: parens left, then value desc, firstNumber desc). */
function formatProductForDisplay(ast: AST): string {
  const terms = flattenTimes(ast);
  const sorted = sortFactorsForDisplay(terms);
  return sorted.map((t) => formatFactorInProduct(t)).join(" * ");
}

/** Format a single signed term (product or number) for root-level display. */
function formatTermForDisplay(ast: AST): string {
  if (ast.type === "num") return ast.val;
  if (ast.type === "bin" && ast.op === "*") return formatProductForDisplay(ast);
  if (ast.type === "bin" && ast.op === "/") {
    const nums = flattenDivide(ast);
    const sorted = nums.map((t) => ({ ast: t, key: termKey(t) })).sort((a, b) => a.key.localeCompare(b.key));
    return sorted
      .map(({ ast: t }) => {
        const s = t.type === "bin" && (t.op === "+" || t.op === "-") ? `(${formatAdditiveForFactor(t)})` : formatFactorInProduct(t);
        return s;
      })
      .join(" / ");
  }
  return formatFactorInProduct(ast);
}

/** Canonical display using group-based rules (break by add/sub then mult/div, rejoin with sorting). */
function canonicalDisplay(ast: AST): string {
  return formatGroupCanonical(ast, false);
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

/** Flatten a chain of × and ÷ into numerator factors and divisors (so we can sort all factors by value). */
function flattenMultDiv(ast: AST): { mult: AST[]; div: AST[] } {
  if (ast.type === "num") return { mult: [ast], div: [] };
  if (ast.type === "bin" && ast.op === "*") {
    const l = flattenMultDiv(ast.left);
    const r = flattenMultDiv(ast.right);
    return { mult: [...l.mult, ...r.mult], div: [...l.div, ...r.div] };
  }
  if (ast.type === "bin" && ast.op === "/") {
    const l = flattenMultDiv(ast.left);
    return { mult: l.mult, div: [...l.div, ast.right] };
  }
  return { mult: [ast], div: [] };
}

/** For ordering factors in a product: add/sub use max term value; mult/div use whole value; num use value. */
function firstTermValue(ast: AST): number {
  if (ast.type === "num") return parseInt(ast.val, 10);
  const v = evalAst(ast);
  if (v === null) return 0;
  if (ast.type === "bin" && (ast.op === "+" || ast.op === "-")) {
    const terms = flattenToSignedTerms(ast);
    let maxVal = 0;
    for (const { ast: t } of terms) {
      const tval = evalAst(t);
      if (tval !== null) {
        const n = Math.abs(ratToNumber(tval));
        if (n > maxVal) maxVal = n;
      }
    }
    return maxVal;
  }
  return Math.abs(ratToNumber(v));
}

/**
 * Group-based canonical format: break by add/sub, then by mult/div, until numbers.
 * Rejoin from inside out: within add/sub sort added terms desc then subtracted terms desc;
 * within mult sort factors by value desc; within div sort numerator factors and divisors desc.
 * Parens when mult/div has more than one term on either side.
 */
function formatGroupCanonical(ast: AST, inMultContext: boolean): string {
  if (ast.type === "num") return ast.val;

  if (ast.type === "bin" && (ast.op === "+" || ast.op === "-")) {
    const terms = flattenToSignedTerms(ast);
    const pos = terms.filter((t) => t.sign > 0).map((t) => t.ast);
    const neg = terms.filter((t) => t.sign < 0).map((t) => t.ast);
    const byVal = (a: AST, b: AST) => {
      const va = evalAst(a);
      const vb = evalAst(b);
      if (va === null || vb === null) return 0;
      return -compare(va, vb);
    };
    pos.sort(byVal);
    neg.sort(byVal);
    const wrap = (t: AST, s: string) => (t.type === "bin" ? `(${s})` : s);
    const posStr = pos.map((t) => wrap(t, formatGroupCanonical(t, false))).join(" + ");
    const negStr = neg.map((t) => wrap(t, formatGroupCanonical(t, false))).join(" - ");
    const out = negStr ? (posStr ? `${posStr} - ${negStr}` : `-${negStr}`) : posStr || "0";
    return inMultContext ? `(${out})` : out;
  }

  const isOne = (t: AST) => t.type === "num" && t.val === "1";
  if (ast.type === "bin" && ast.op === "*") {
    const { mult, div } = flattenMultDiv(ast);
    const multSorted = [...mult].sort((a, b) => {
      if (isOne(a) && !isOne(b)) return 1;
      if (!isOne(a) && isOne(b)) return -1;
      if (isOne(a) && isOne(b)) return 0;
      const va = evalAst(a);
      const vb = evalAst(b);
      if (va === null || vb === null) return 0;
      return -compare(va, vb);
    });
    const multParts = multSorted.map((t) => {
      const needsParens = t.type === "bin" && (t.op === "+" || t.op === "-");
      return formatGroupCanonical(t, needsParens);
    });
    if (div.length > 0) {
      const divSorted = [...div].sort((a, b) => {
        const va = evalAst(a);
        const vb = evalAst(b);
        if (va === null || vb === null) return 0;
        return -compare(va, vb);
      });
      const divParts = divSorted.map((d) => {
        const s = formatGroupCanonical(d, false);
        return d.type === "bin" ? `(${s})` : s;
      });
      return multParts.join(" * ") + " / " + divParts.join(" / ");
    }
    return multParts.join(" * ");
  }

  if (ast.type === "bin" && ast.op === "/") {
    const chain = flattenDivide(ast);
    const numer = chain[0]!;
    const divisors = chain.slice(1);
    const numerFactors = flattenTimes(numer);
    const numerSorted = [...numerFactors].sort((a, b) => {
      if (isOne(a) && !isOne(b)) return 1;
      if (!isOne(a) && isOne(b)) return -1;
      if (isOne(a) && isOne(b)) return 0;
      const va = evalAst(a);
      const vb = evalAst(b);
      if (va === null || vb === null) return 0;
      return -compare(va, vb);
    });
    const divSorted = [...divisors].sort((a, b) => {
      const va = evalAst(a);
      const vb = evalAst(b);
      if (va === null || vb === null) return 0;
      return -compare(va, vb);
    });
    const numerStr =
      numerSorted.length > 1
        ? numerSorted.map((t) => formatGroupCanonical(t, false)).join(" * ")
        : formatGroupCanonical(numer, false);
    const numerNeedsParens = numer.type === "bin" && (numer.op === "+" || numer.op === "-");
    const numerOut = numerNeedsParens ? `(${numerStr})` : numerStr;
    const divOut = divSorted
      .map((d) => {
        const s = formatGroupCanonical(d, false);
        return d.type === "bin" ? `(${s})` : s;
      })
      .join(" / ");
    return divOut ? `${numerOut} / ${divOut}` : numerOut;
  }

  return "";
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

function countNegativeParens(expr: string): number {
  const s = expr.replace(/[−×÷]/g, (c) => ({ "−": "-", "×": "*", "÷": "/" }[c]!));
  const stack: number[] = [];
  let count = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      stack.push(i);
    } else if (ch === ")" && stack.length > 0) {
      const start = stack.pop()!;
      const inner = s.slice(start + 1, i).trim();
      if (!inner) continue;
      const ast = parseExpr(inner);
      if (!ast) continue;
      const v = evalAst(ast);
      if (v && v.n < 0n) {
        count++;
      }
    }
  }

  return count;
}

/** Every group (direct child of +, −, ×, or ÷) must evaluate to a non-negative number. */
function everyGroupNonNegative(ast: AST): boolean {
  if (ast.type === "num") {
    const n = parseInt(ast.val, 10);
    return n >= 0;
  }
  const { left, right } = ast;
  const lv = evalAst(left);
  const rv = evalAst(right);
  if (lv !== null && lv.n < 0n) return false;
  if (rv !== null && rv.n < 0n) return false;
  return everyGroupNonNegative(left) && everyGroupNonNegative(right);
}

/** True if ×1 appears only at the very end (e.g. "... ) × 1" or "... × 1 × 1"). */
function timesOneOnlyAtEnd(s: string): boolean {
  return /([×*]\s*1)+$/.test(s.trim());
}

/** Prefer displays: ×1 only at end, fewer subtract-of-parens, ×1 over ÷1, a×0 over 0÷a, then shorter. */
function preferDisplay(candidate: string, existing: string): boolean {
  const atEndC = timesOneOnlyAtEnd(candidate);
  const atEndE = timesOneOnlyAtEnd(existing);
  if (atEndC && !atEndE) return true;
  if (!atEndC && atEndE) return false;
  const negParens = (x: string) => countNegativeParens(x);
  const subParen = (x: string) => (x.match(/[−\-]\s*\(/g) ?? []).length;
  const divBy1 = (x: string) => (x.match(/[÷\/]\s*1\b/g) ?? []).length;
  const zeroDivided = (x: string) => (x.match(/\b0\s*[÷\/]/g) ?? []).length;
  const negC = negParens(candidate);
  const negE = negParens(existing);
  if (negC < negE) return true;
  if (negC > negE) return false;
  if (subParen(candidate) < subParen(existing)) return true;
  if (subParen(candidate) > subParen(existing)) return false;
  if (divBy1(candidate) < divBy1(existing)) return true;
  if (divBy1(candidate) > divBy1(existing)) return false;
  if (zeroDivided(candidate) < zeroDivided(existing)) return true;
  if (zeroDivided(candidate) > zeroDivided(existing)) return false;
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
      if (!everyGroupNonNegative(normalized)) return;
      const key = canonicalize(stripTrailingOnes(normalized), true);
      let display = canonicalDisplay(normalized)
        .replace(/\*/g, "×")
        .replace(/\s-\s/g, " − ")
        .replace(/^-/g, "−");
      const displayParsed = parseExpr(display.replace(/[−×÷]/g, (c) => ({ "−": "-", "×": "*", "÷": "/" }[c]!)));
      const displayValue = displayParsed ? evalAst(displayParsed) : null;
      if (displayValue === null || !eq(displayValue, target)) {
        display = minimizeParens(expr);
      }
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
  return out.replace(/[*]/g, "×").replace(/-/g, "−");
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
