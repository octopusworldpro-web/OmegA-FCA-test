module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "script"
  },
  extends: ["eslint:recommended"],
  rules: {
    "no-debugger": "error",
    "no-unreachable": "error",
    "no-constant-condition": ["error", { checkLoops: false }],
    "valid-typeof": "error",
    "no-duplicate-imports": "error"
  },
  ignorePatterns: ["dist/", "node_modules/"]
};
