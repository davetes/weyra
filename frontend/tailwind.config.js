/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './pages/**/*.{js,jsx}',
        './components/**/*.{js,jsx}',
    ],
    theme: {
        extend: {
            colors: {
                bg: '#101418',
                panel: '#1b2128',
                border: '#2a333d',
                muted: '#9aa7b2',
                accent: '#b2640c',
                'accent-hover': '#e27400',
                'purple-dark': '#2a0e46',
                'purple-mid': '#3a2c7a',
                'purple-bright': '#970cf4',
                'purple-glow': '#7c3aed',
                'green-bingo': '#2ecc71',
                'red-bingo': '#e74c3c',
                'red-called': '#c0392b',
                'yellow-bingo': '#f39c12',
                'blue-bingo': '#2d89ff',
                'pink-bingo': '#d81b60',
                'gold': '#d4a017',
                'gold-border': '#b8850c',
                'gold-gradient-from': '#f6a623',
                'gold-gradient-to': '#d8890b',
                'board-cell': '#2a3441',
                'card-free': '#173e1f',
                'card-free-border': '#2a7a3b',
            },
            fontFamily: {
                sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell', 'Noto Sans', 'sans-serif'],
            },
            keyframes: {
                pulse3: {
                    '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.6' },
                    '40%': { transform: 'scale(1)', opacity: '1' },
                },
            },
            animation: {
                pulse3: 'pulse3 1.2s infinite ease-in-out',
            },
        },
    },
    plugins: [],
};
