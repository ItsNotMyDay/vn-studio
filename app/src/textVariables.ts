import type { Character, Variable } from './store';

export function characterVariableAlias(character: Pick<Character, 'id' | 'name' | 'isNarrator'>): string {
  if (character.isNarrator || character.id === 'global') return 'GLOBAL';
  return character.name.trim().toLocaleUpperCase().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
}

export function resolveVariableText(
  source: string,
  characters: Character[],
  values: Record<string, string | number | boolean>,
): string {
  const byAlias = new Map<string, Character>();
  characters.forEach(character => byAlias.set(characterVariableAlias(character), character));
  return String(source ?? '').replace(
    /@([\p{L}\p{N}_-]+)\.([\p{L}\p{N}_-]+)/gu,
    (token, alias: string, key: string) => {
      const character = byAlias.get(alias.toLocaleUpperCase());
      if (!character) return token;
      const variable = character.vars.find(item => item.key.toLocaleUpperCase() === key.toLocaleUpperCase());
      if (!variable) return token;
      const actualKey = `${character.id}.${variable.key}`;
      const value = Object.prototype.hasOwnProperty.call(values, actualKey) ? values[actualKey] : variable.value;
      return String(value ?? '');
    },
  );
}

export type VariableAutocomplete =
  | { kind: 'character'; start: number; end: number; query: string; items: Character[] }
  | { kind: 'variable'; start: number; end: number; query: string; character: Character; items: Variable[] }
  | null;

export function getVariableAutocomplete(
  value: string,
  cursor: number,
  characters: Character[],
): VariableAutocomplete {
  const prefix = value.slice(0, cursor);
  const match = /@([^@\s]*)$/u.exec(prefix);
  if (!match) return null;
  const token = match[1];
  const start = cursor - match[0].length;
  const dot = token.indexOf('.');
  if (dot < 0) {
    const query = token.toLocaleUpperCase();
    const items = characters.filter(character => characterVariableAlias(character).includes(query));
    return { kind: 'character', start, end: cursor, query, items };
  }
  const alias = token.slice(0, dot).toLocaleUpperCase();
  const query = token.slice(dot + 1).toLocaleUpperCase();
  const character = characters.find(item => characterVariableAlias(item) === alias);
  if (!character) return null;
  const items = character.vars.filter(variable => variable.key.toLocaleUpperCase().includes(query));
  return { kind: 'variable', start: start + dot + 2, end: cursor, query, character, items };
}

export interface CharacterReferenceAutocomplete {
  start: number;
  end: number;
  query: string;
  items: Character[];
}

export function getCharacterReferenceAutocomplete(
  value: string,
  cursor: number,
  characters: Character[],
): CharacterReferenceAutocomplete | null {
  const prefix = value.slice(0, cursor);
  const match = /@([^@\\s.]*)$/u.exec(prefix);
  if (!match) return null;
  const query = match[1].toLocaleUpperCase();
  const start = cursor - match[0].length;
  const items = characters.filter(character =>
    !character.isNarrator && characterVariableAlias(character).includes(query),
  );
  return { start, end: cursor, query, items };
}

/** Build only visual traits; character personality is intentionally excluded from image prompts. */
export function describeCharacterAppearance(character: Character): string {
  const hairStyles: Record<Character['hairStyle'], string> = {
    short: 'short hairstyle',
    messy: 'messy tousled hairstyle',
    long: 'long hairstyle',
  };
  const details = [
    character.appearance?.trim(),
    hairStyles[character.hairStyle],
    `hair color ${character.hair}`,
    `clothing color ${character.jacket}`,
    `skin tone ${character.skin}`,
  ].filter(Boolean);
  return `visual appearance of ${character.name}: ${details.join(', ')}`;
}

/** Replace @CHARACTER aliases in image prompts with that character's visual description. */
export function expandCharacterReferences(prompt: string, characters: Character[]): string {
  const byAlias = new Map<string, Character>();
  characters.filter(character => !character.isNarrator).forEach(character => {
    byAlias.set(characterVariableAlias(character).toLocaleUpperCase(), character);
  });
  return String(prompt ?? '').replace(
    /@([\\p{L}\\p{N}_-]+)(?![\\p{L}\\p{N}_-]|\\.)/gu,
    (token, alias: string) => {
      const character = byAlias.get(alias.toLocaleUpperCase());
      if (!character) return token;
      return `[CHARACTER VISUAL REFERENCE: ${describeCharacterAppearance(character)}. Reproduce these visual traits consistently.]`;
    },
  );
}
