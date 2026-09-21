import {
    describe,
    expect,
    it
  } from "vitest";
  
  import {
    getEthiopianLanguageHints
  } from "../src/ai/ethiopian-language-hints.js";
  
  describe(
    "Ethiopian language hints",
    () => {
      it(
        "recognizes the curated transliterated shoe term",
        () => {
          expect(
            getEthiopianLanguageHints(
              "chama"
            )
          ).toEqual([
            {
              token: "chama",
              meaning: "shoe or shoes",
              role: "product-term"
            }
          ]);
        }
      );
  
      it(
        "recognizes conversational existence wording without treating it as a product constraint",
        () => {
          const hints =
            getEthiopianLanguageHints(
              "shoe ale?"
            );
  
          expect(hints).toHaveLength(1);
  
          expect(hints[0]).toMatchObject({
            token: "ale",
            role: "conversation-term"
          });
  
          expect(
            hints[0]?.meaning
          ).toContain(
            "not by itself a sale"
          );
        }
      );
  
      it(
        "returns both exact hints from mixed transliterated input",
        () => {
          const hints =
            getEthiopianLanguageHints(
              "black chama ale?"
            );
  
          expect(
            hints.map(
              (hint) => hint.token
            )
          ).toEqual([
            "chama",
            "ale"
          ]);
        }
      );
  
      it(
        "matches curated tokens case-insensitively",
        () => {
          expect(
            getEthiopianLanguageHints(
              "CHAMA ALE?"
            ).map(
              (hint) => hint.token
            )
          ).toEqual([
            "chama",
            "ale"
          ]);
        }
      );
  
      it(
        "deduplicates repeated curated tokens",
        () => {
          expect(
            getEthiopianLanguageHints(
              "chama chama ale ale"
            ).map(
              (hint) => hint.token
            )
          ).toEqual([
            "chama",
            "ale"
          ]);
        }
      );
  
      it(
        "does not guess meanings for unknown Latin words",
        () => {
          expect(
            getEthiopianLanguageHints(
              "Urban Classic ZX900"
            )
          ).toEqual([]);
        }
      );
  
      it(
        "does not fuzzy-match similar-looking words",
        () => {
          expect(
            getEthiopianLanguageHints(
              "chamma ales sale"
            )
          ).toEqual([]);
        }
      );
  
      it(
        "does not alter or return the original customer message",
        () => {
          const original =
            "black chama ale?";
  
          const hints =
            getEthiopianLanguageHints(
              original
            );
  
          expect(original).toBe(
            "black chama ale?"
          );
  
          expect(
            hints.some(
              (hint) =>
                hint.token === original
            )
          ).toBe(false);
        }
      );
    }
  );