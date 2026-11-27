import '../shared/style.css';
import '../shared/harness.js';
import { mount } from 'svelte';
import App from './App.svelte';
mount(App, { target: document.getElementById('app') });
