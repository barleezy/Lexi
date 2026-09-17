export function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const names = Object.keys(process.env)
    .filter((k) => /STRIPE|PRICE/i.test(k))
    .sort();
  console.info("[env] STRIPE|PRICE names", names);
}
