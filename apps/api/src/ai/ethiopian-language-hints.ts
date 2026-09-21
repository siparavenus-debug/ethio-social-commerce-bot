export type EthiopianLanguageHint = {
    token: string;
    meaning: string;
    role:
      | "product-term"
      | "conversation-term";
  };
  
  const EXACT_TOKEN_HINTS:
    Readonly<
      Record<
        string,
        Omit<
          EthiopianLanguageHint,
          "token"
        >
      >
    > = {
      chama: {
        meaning: "shoe or shoes",
        role: "product-term"
      },
  
      ale: {
        meaning:
          "Amharic conversational/existence wording; in a shopping question it may mean 'is there?' or 'do you have?' and is not by itself a sale, promotion, or product constraint",
        role: "conversation-term"
      }
    };
  
  function tokenizeLatinWords(
    text: string
  ): string[] {
    return (
      text
        .toLocaleLowerCase()
        .match(/[a-z]+/g) ?? []
    );
  }
  
  export function getEthiopianLanguageHints(
    text: string
  ): EthiopianLanguageHint[] {
    const tokens =
      tokenizeLatinWords(text);
  
    const seen =
      new Set<string>();
  
    const hints:
      EthiopianLanguageHint[] = [];
  
    for (const token of tokens) {
      if (seen.has(token)) {
        continue;
      }
  
      seen.add(token);
  
      const hint =
        EXACT_TOKEN_HINTS[token];
  
      if (!hint) {
        continue;
      }
  
      hints.push({
        token,
        ...hint
      });
    }
  
    return hints;
  }