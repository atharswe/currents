/**
 * Translates a user's search box input into an FTS5 MATCH expression.
 *
 * Raw input cannot be passed through: FTS5 treats characters like `"`, `*`, `:`, `^`, `-`, and
 * the bare words AND/OR/NOT as query syntax, so a search for `C++ "hello` is a syntax error
 * rather than zero results. Every term is quoted, which makes it a literal, and the final term
 * gets a prefix wildcard so results narrow as the user keeps typing.
 *
 * Quoted phrases in the input are preserved as phrase searches.
 *
 * Returns null when there is nothing searchable, so callers can skip the query entirely.
 */
export function toFtsQuery(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const terms: { text: string; isPhrase: boolean }[] = [];
  // Either a "quoted phrase" or a run of characters up to the next whitespace or quote.
  const pattern = /"([^"]*)"|([^\s"]+)/g;

  for (const match of trimmed.matchAll(pattern)) {
    const phrase = match[1];
    const word = match[2];

    if (phrase !== undefined) {
      const cleaned = phrase.trim();
      if (cleaned.length > 0) terms.push({ text: cleaned, isPhrase: true });
      continue;
    }
    if (word) terms.push({ text: word, isPhrase: false });
  }

  if (terms.length === 0) return null;

  return terms
    .map((term, index) => {
      // FTS5 escapes a double quote inside a string by doubling it.
      const escaped = term.text.replace(/"/g, '""');
      const isLast = index === terms.length - 1;
      // A trailing wildcard only makes sense on a single word, and only on the term the user
      // is still typing.
      const wildcard =
        isLast && !term.isPhrase && term.text.length > 1 ? "*" : "";
      return `"${escaped}"${wildcard}`;
    })
    .join(" ");
}
