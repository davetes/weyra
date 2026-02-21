/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                bg: '#0b1220',
                panel: '#111a2e',
                border: '#22304a',
                muted: '#9aa7b2',
                accent: '#6366f1',
                'accent-hover': '#4f46e5',
            },
        },
    },
    plugins: [],
};
