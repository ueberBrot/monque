import ReactDOM from 'react-dom/client';

import { DashboardDevShellApp } from './dev-shell-app.js';
import { readDashboardDevEnvironment } from './runtime-config.js';

const rootElement = document.getElementById('app');

if (!rootElement) {
	throw new Error('Missing #app root element.');
}

const root = ReactDOM.createRoot(rootElement);
root.render(<DashboardDevShellApp environment={readDashboardDevEnvironment()} />);
