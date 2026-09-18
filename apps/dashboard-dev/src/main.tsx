import ReactDOM from 'react-dom/client';

import monqueLogo from '@/assets/monque.svg';

import { DashboardDevShellApp } from './dev-shell-app.js';
import { readDashboardDevEnvironment } from './runtime-config.js';

const rootElement = document.getElementById('app');

if (!rootElement) {
	throw new Error('Missing #app root element.');
}

const root = ReactDOM.createRoot(rootElement);
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = monqueLogo;
document.head.append(favicon);
root.render(<DashboardDevShellApp environment={readDashboardDevEnvironment()} />);
