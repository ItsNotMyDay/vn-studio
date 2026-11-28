import { useRef, useState } from 'react';
import { characterVariableAlias, getCharacterReferenceAutocomplete } from './textVariables';
import type { Character } from './store';

export function CharacterPromptTextarea({
  value,
  onChange,
  characters,
  className = 'textarea',
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  characters: Character[];
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestion, setSuggestion] = useState<ReturnType<typeof getCharacterReferenceAutocomplete>>(null);
  const refresh = (text: string, cursor: number) =>
    setSuggestion(getCharacterReferenceAutocomplete(text, cursor, characters));

  const insert = (character: Character) => {
    if (!suggestion || !ref.current) return;
    const token = '@' + characterVariableAlias(character) + ' ';
    const next = value.slice(0, suggestion.start) + token + value.slice(suggestion.end);
    const caret = suggestion.start + token.length;
    onChange(next);
    setSuggestion(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onClick={e => refresh(value, e.currentTarget.selectionStart)}
        onKeyUp={e => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            refresh(value, e.currentTarget.selectionStart);
          }
        }}
        onBlur={() => window.setTimeout(() => setSuggestion(null), 120)}
      />
      {suggestion && (
        <div className="absolute left-0 right-0 top-full z-[65] mt-1 max-h-48 overflow-y-auto rounded-lg border border-ink-500 bg-ink-950 shadow-2xl p-1">
          {suggestion.items.map(character => (
            <button
              key={character.id}
              type="button"
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-ink-700"
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(character)}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: character.color }} />
              <span className="flex-1 truncate">{character.name}</span>
              <span className="text-[10px] text-mute font-mono">@{characterVariableAlias(character)}</span>
            </button>
          ))}
          {suggestion.items.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-mute">Персонажи не найдены</div>
          )}
        </div>
      )}
    </div>
  );
}
