import ReactDOM from 'react-dom/client';

import { createDashboardContent } from './bootstrap.js';

const rootElement = document.getElementById('app');

if (!rootElement) {
	throw new Error('Missing #app root element.');
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(createDashboardContent(window.__MONQUE_DASHBOARD_CONFIG__));
}
