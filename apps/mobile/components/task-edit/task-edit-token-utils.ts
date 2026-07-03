export const parseTokenList = (value: string | undefined, tokenPrefix: '@' | '#'): string[] => {
    if (!value) return [];
    const tokens = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            if (item.startsWith(tokenPrefix)) return item;
            const stripped = item.replace(/^[@#]+/, '').trim();
            if (!stripped) return '';
            return `${tokenPrefix}${stripped}`;
        })
        .filter(Boolean);

    return Array.from(new Set(tokens));
};

export const getActiveTokenQuery = (value: string | undefined, _tokenPrefix: '@' | '#'): string => {
    if (!value) return '';
    const draft = value.split(',').pop()?.trim() ?? '';
    const stripped = draft.replace(/^[@#]+/, '').trim();
    if (!stripped) return '';
    return stripped.toLowerCase();
};

export const replaceTrailingToken = (value: string | undefined, token: string): string => {
    const source = value ?? '';
    const lastCommaIndex = source.lastIndexOf(',');
    if (lastCommaIndex === -1) {
        return `${token}, `;
    }
    const head = source.slice(0, lastCommaIndex + 1).trimEnd();
    return `${head} ${token}, `;
};

