import { useEffect, useMemo, useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

type AutocompleteTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string;
    onChange: (value: string) => void;
    suggestions: readonly string[];
    maxSuggestions?: number;
};

// Text input with an inline suggestion dropdown. Unlike the task editor's
// autocomplete, Enter only picks a suggestion after the user arrows into the
// list, so host forms (modals, wizards) keep their own Enter semantics.
export function AutocompleteTextInput({
    value,
    onChange,
    suggestions,
    maxSuggestions = 6,
    className,
    onKeyDown,
    onFocus,
    onBlur,
    ...inputProps
}: AutocompleteTextInputProps) {
    const [focused, setFocused] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const query = value.trim();

    const matches = useMemo(() => {
        if (!focused || !query) return [];
        const queryKey = query.toLowerCase();
        const seen = new Set<string>();
        const result: string[] = [];
        for (const option of suggestions) {
            const key = option.trim().toLowerCase();
            if (!key || key === queryKey || seen.has(key) || !key.includes(queryKey)) continue;
            seen.add(key);
            result.push(option);
            if (result.length >= maxSuggestions) break;
        }
        return result;
    }, [focused, query, suggestions, maxSuggestions]);

    useEffect(() => {
        setActiveIndex(-1);
    }, [query]);

    const selectSuggestion = (option: string) => {
        onChange(option);
        setActiveIndex(-1);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (matches.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % matches.length);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
                return;
            }
            if (event.key === 'Enter' && activeIndex >= 0) {
                event.preventDefault();
                event.stopPropagation();
                selectSuggestion(matches[activeIndex]);
                return;
            }
            if (event.key === 'Escape' && activeIndex >= 0) {
                event.stopPropagation();
                setActiveIndex(-1);
                return;
            }
        }
        onKeyDown?.(event);
    };

    return (
        <div className="relative">
            <input
                {...inputProps}
                type={inputProps.type ?? 'text'}
                value={value}
                aria-autocomplete="list"
                aria-expanded={matches.length > 0}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={(event) => {
                    setFocused(true);
                    onFocus?.(event);
                }}
                onBlur={(event) => {
                    setFocused(false);
                    onBlur?.(event);
                }}
                className={className}
            />
            {matches.length > 0 && (
                <div
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
                >
                    {matches.map((option, index) => (
                        <button
                            key={option}
                            type="button"
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                selectSuggestion(option);
                            }}
                            className={cn(
                                'flex w-full items-center px-2.5 py-1.5 text-left text-xs transition-colors',
                                index === activeIndex
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted/70'
                            )}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
