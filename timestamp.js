const ts = process.argv[2];

if (!ts) {
  console.log("Usage: node timestamp.js <timestamp>");
  process.exit(1);
}

const date = new Date(Number(ts));

console.log("Raw:", ts);
console.log("Local:", date.toLocaleString());
console.log("UTC:", date.toUTCString());
console.log("ISO:", date.toISOString());

//node timestamp.js 1773461276900