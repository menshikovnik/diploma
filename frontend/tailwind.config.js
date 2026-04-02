export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                ink: '#0f172a',
                mist: '#e2e8f0',
                accent: '#0f766e',
                accentSoft: '#ccfbf1',
                danger: '#b91c1c',
                warning: '#a16207',
            },
            boxShadow: {
                panel: '0 24px 80px rgba(15, 23, 42, 0.12)',
            },
            backgroundImage: {
                grid: 'radial-gradient(circle at top, rgba(15,118,110,0.12), transparent 30%), linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)',
            },
            backgroundSize: {
                grid: '100% 100%, 32px 32px, 32px 32px',
            },
        },
    },
    plugins: [],
};
