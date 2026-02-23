import { Rational, Op } from "./types";

function bigAbs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function gcd(a: bigint, b: bigint): bigint {
  a = bigAbs(a);
  b = bigAbs(b);
  while (b > 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function rat(n: number | bigint, d: number | bigint = 1): Rational {
  return normalize(BigInt(n), BigInt(d));
}

export function normalize(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error("Division by zero");
  if (n === 0n) return { n: 0n, d: 1n };
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(bigAbs(n), d);
  return { n: n / g, d: d / g };
}

export function add(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.n, a.d * b.d);
}

export function div(a: Rational, b: Rational): Rational | null {
  if (b.n === 0n) return null;
  return normalize(a.n * b.d, a.d * b.n);
}

export function eq(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function applyOp(a: Rational, op: Op, b: Rational): Rational | null {
  switch (op) {
    case "+": return add(a, b);
    case "-": return sub(a, b);
    case "*": return mul(a, b);
    case "/": return div(a, b);
  }
}

export function ratToString(r: Rational): string {
  if (r.d === 1n) return r.n.toString();
  return `${r.n}/${r.d}`;
}

export function ratToNumber(r: Rational): number {
  return Number(r.n) / Number(r.d);
}

export function serializeRational(r: Rational): { n: string; d: string } {
  return { n: r.n.toString(), d: r.d.toString() };
}

export function deserializeRational(r: { n: string; d: string }): Rational {
  return { n: BigInt(r.n), d: BigInt(r.d) };
}
