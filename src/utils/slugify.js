const nameOverrides = {
  "brian thomas": "brian thomas jr",
  "de'von achane": "devon achane",
  "luther burden": "luther burden iii",
  "michael penix": "michael penix jr.",
  "tyrone tracy": "tyrone tracy jr.",
  "marvin mims": "marvin mims jr.",
  "hollywood brown": "marquise brown",
  "calvin austin": "calvin austin iii",
  "joe milton": "joe milton iii",
  "efton chism": "efton chism iii",
  "jimmy horn": "jimmy horn jr.",
  "thomas fidone": "thomas fidone ii",
  "chris rodriguez": "chris rodriguez jr.",
  "ricky white": "ricky white iii",
  "josh palmer": "joshua palmer",
  "harold fannin": "harold fannin jr.",
  "donte thornton": "dont'e thornton jr.",
  "ollie gordon": "ollie gordon ii",
};

export function toSlug(name) {
  if (!name) return "";
  const cleaned = name.toLowerCase();
  const override = nameOverrides[cleaned] || name;
  return override
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
