/* Desktop edition (Tauri 2): the shared UI + the core, on fuelpro.db in the app's data folder. No network at all. */
import { invoke } from '@tauri-apps/api/core';
import { openBridge, tauriBridge } from '@fuelpro/db/browser';
import { localBackend } from '@fuelpro/local';
import { mount } from '@fuelpro/ui';

mount(document.getElementById('app')!, localBackend(() => openBridge(tauriBridge(invoke)), 'desktop'));
