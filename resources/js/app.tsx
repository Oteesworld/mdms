import { createInertiaApp } from '@inertiajs/react';
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';

// Each page is its own chunk, so the sign-in pages load without the whole app.
const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx');

createInertiaApp({
  title: (title) => (title ? `${title} · Amplified IoT` : 'Amplified IoT'),
  resolve: async (name) => {
    const page = pages[`./pages/${name}.tsx`];
    if (!page) throw new Error(`Unknown page: ${name}`);
    return (await page()).default;
  },
  setup({ el, App, props }) {
    createRoot(el).render(
      <StrictMode>
        <App {...props} />
      </StrictMode>,
    );
  },
  progress: { color: '#00468C', delay: 200 },
});
