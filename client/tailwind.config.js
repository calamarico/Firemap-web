/** @type {import('tailwindcss').Config} */
// Las clases utilitarias referencian las CSS variables de src/styles/tokens.css:
// una sola fuente de verdad, las clases y las variables no pueden divergir.
export default {
  // *.html: los tres documentos del build (app, /embed y /insertar).
  content: ['./*.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--fm-bg-app, #020617)',
        void: 'var(--fm-void, #0b1420)',
        surface: {
          panel: 'var(--fm-surface-panel)',
          raised: 'var(--fm-surface-raised)',
          sunken: 'var(--fm-surface-sunken)',
          hover: 'var(--fm-surface-hover)',
        },
        edge: {
          subtle: 'var(--fm-border-subtle)',
          DEFAULT: 'var(--fm-border-default)',
          strong: 'var(--fm-border-strong)',
        },
        ink: {
          primary: 'var(--fm-text-primary)',
          secondary: 'var(--fm-text-secondary)',
          muted: 'var(--fm-text-muted)',
          faint: 'var(--fm-text-faint)',
        },
        action: {
          DEFAULT: 'var(--fm-action-bg)',
          hover: 'var(--fm-action-bg-hover)',
          active: 'var(--fm-action-bg-active)',
          subtle: 'var(--fm-action-bg-subtle)',
          fg: 'var(--fm-action-fg)',
        },
        ember: {
          DEFAULT: 'var(--fm-brand-ember)',
          text: 'var(--fm-brand-ember-text)',
          subtle: 'var(--fm-brand-ember-subtle)',
        },
        severity: {
          1: 'var(--fm-severity-1)',
          2: 'var(--fm-severity-2)',
          3: 'var(--fm-severity-3)',
          4: 'var(--fm-severity-4)',
        },
        burnt: 'var(--fm-burnt-fill)',
        ok: 'var(--fm-ok-dot)',
        warn: {
          fg: 'var(--fm-warn-fg)',
          bg: 'var(--fm-warn-bg)',
          border: 'var(--fm-warn-border)',
        },
        danger: {
          fg: 'var(--fm-danger-fg)',
          bg: 'var(--fm-danger-bg)',
          border: 'var(--fm-danger-border)',
        },
      },
      fontFamily: { display: ['Montserrat', 'Segoe UI', 'system-ui', 'sans-serif'] },
      fontSize: {
        'metric-xl': ['2.5rem', { lineHeight: '1.15' }],
        'metric-lg': ['1.875rem', { lineHeight: '1.15' }],
        'metric-md': ['1.375rem', { lineHeight: '1.15' }],
        micro: ['0.6875rem', { lineHeight: '1.35' }],
      },
      borderRadius: { md: '6px', lg: '8px', xl: '12px' },
      boxShadow: {
        panel: 'var(--fm-shadow-panel)',
        popup: 'var(--fm-shadow-popup)',
        control: 'var(--fm-shadow-control)',
        focus: 'var(--fm-focus-shadow)',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      transitionTimingFunction: { sheet: 'cubic-bezier(0.16,1,0.3,1)' },
      zIndex: { panel: '10', popup: '20', sheet: '30' },
    },
  },
  plugins: [],
};
