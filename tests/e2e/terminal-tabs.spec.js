/**
 * Terminal Tabs E2E Tests
 *
 * Verifies the tab bar: creating tabs, cycling between them, and
 * renaming a tab from the context menu.
 */

import { expect, browser } from '@wdio/globals';

describe('terminal tabs', () => {
  beforeEach(async () => {
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );
  });

  it('starts with one tab labeled "1"', async () => {
    const tabCount = await browser.execute(() => {
      return document.querySelectorAll('.tab').length;
    });

    expect(tabCount).toBe(1);

    const label = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const tab = component.tabs.find((t) => t.id === component.activeTabId);
      return tab.labelElement.textContent;
    });

    expect(label).toBe('1');
  });

  it('opens a new tab and switches to it', async () => {
    const ids = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      return { firstId, secondId };
    });

    expect(ids.secondId).not.toBe(ids.firstId);

    const activeTabId = await browser.execute(() => {
      return document.querySelector('terminal-component').activeTabId;
    });

    expect(activeTabId).toBe(ids.secondId);

    const tabCount = await browser.execute(() => {
      return document.querySelectorAll('.tab').length;
    });

    expect(tabCount).toBe(2);
  });

  it('cycles between tabs with cycleTab', async () => {
    const ids = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      return { firstId, secondId };
    });

    await browser.execute(() => {
      document.querySelector('terminal-component').cycleTab(1);
    });

    const activeAfterForward = await browser.execute(() => {
      return document.querySelector('terminal-component').activeTabId;
    });

    expect(activeAfterForward).toBe(ids.firstId);

    await browser.execute(() => {
      document.querySelector('terminal-component').cycleTab(-1);
    });

    const activeAfterBackward = await browser.execute(() => {
      return document.querySelector('terminal-component').activeTabId;
    });

    expect(activeAfterBackward).toBe(ids.secondId);
  });

  it('renames a tab', async () => {
    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.renameTab(component.activeTabId, 'Shell');
    });

    const label = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const tab = component.tabs.find((t) => t.id === component.activeTabId);
      return tab.labelElement.textContent;
    });

    expect(label).toBe('Shell');
  });

  it('labels new tabs with sequential numbers', async () => {
    const labels = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      await component.openTab();
      await component.openTab();
      return component.tabs.map((t) => t.labelElement.textContent);
    });

    expect(labels).toEqual(['1', '2', '3']);
  });

  it('fills gaps when numbering a new tab', async () => {
    const result = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      const thirdId = await component.openTab();
      const fourthId = await component.openTab();
      component.closeTab(secondId);
      component.closeTab(thirdId);
      const newId = await component.openTab();
      return {
        newId,
        labels: component.tabs.map((t) => t.labelElement.textContent),
      };
    });

    expect(result.newId).toBe(2);
    expect(result.labels).toEqual(['1', '2', '4']);
  });

  it('keeps tabs ordered numerically after closing and reopening a lower tab', async () => {
    const result = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      component.closeTab(firstId);
      const newId = await component.openTab();
      return {
        labels: component.tabs.map((t) => t.labelElement.textContent),
        ids: component.tabs.map((t) => t.id),
      };
    });

    expect(result.labels).toEqual(['1', '2']);
    expect(result.ids).toEqual([1, 2]);
  });

  it('switches to tabs 1-9 with Cmd/Ctrl+1-9', async () => {
    const ids = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      const thirdId = await component.openTab();
      return { firstId, secondId, thirdId };
    });

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.handleKeyDown(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    });

    const afterOne = await browser.execute(() => document.querySelector('terminal-component').activeTabId);
    expect(afterOne).toBe(ids.firstId);

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.handleKeyDown(new KeyboardEvent('keydown', { key: '3', metaKey: true }));
    });

    const afterThree = await browser.execute(() => document.querySelector('terminal-component').activeTabId);
    expect(afterThree).toBe(ids.thirdId);
  });

  it('switches to the tenth tab with Cmd/Ctrl+0', async () => {
    const ids = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const ids = [component.activeTabId];
      for (let i = 1; i < 10; i += 1) {
        ids.push(await component.openTab());
      }
      return ids;
    });

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.handleKeyDown(new KeyboardEvent('keydown', { key: '0', metaKey: true }));
    });

    const activeTabId = await browser.execute(() => document.querySelector('terminal-component').activeTabId);
    expect(activeTabId).toBe(ids[9]);
  });

  it('remembers tab numbers after other tabs are closed', async () => {
    const ids = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      const firstId = component.activeTabId;
      const secondId = await component.openTab();
      const thirdId = await component.openTab();
      const fourthId = await component.openTab();
      component.closeTab(firstId);
      component.closeTab(secondId);
      component.closeTab(thirdId);
      return { fourthId };
    });

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.handleKeyDown(new KeyboardEvent('keydown', { key: '4', metaKey: true }));
    });

    const activeTabId = await browser.execute(() => document.querySelector('terminal-component').activeTabId);
    expect(activeTabId).toBe(ids.fourthId);
  });

  it('opens a new tab with the pressed number when that tab does not exist', async () => {
    await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      await component.openTab();
    });

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      component.handleKeyDown(new KeyboardEvent('keydown', { key: '5', metaKey: true }));
    });

    await browser.waitUntil(async () => {
      const state = await browser.execute(() => {
        const component = document.querySelector('terminal-component');
        return { activeTabId: component.activeTabId, tabCount: component.tabs.length };
      });
      return state.tabCount === 3 && state.activeTabId === 5;
    }, { timeout: 5000 });

    const labels = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      return component.tabs.map((t) => t.labelElement.textContent);
    });

    expect(labels).toEqual(['1', '2', '5']);
  });
});
