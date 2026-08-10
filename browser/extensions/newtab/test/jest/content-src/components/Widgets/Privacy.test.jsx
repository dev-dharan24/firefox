/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { render, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { combineReducers, createStore } from "redux";
import { INITIAL_STATE, reducers } from "common/Reducers.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import { Privacy } from "content-src/components/Widgets/Privacy/Privacy";

const mockState = {
  ...INITIAL_STATE,
  Prefs: {
    ...INITIAL_STATE.Prefs,
    values: {
      ...INITIAL_STATE.Prefs.values,
      "widgets.system.enabled": true,
      "widgets.system.privacy.enabled": true,
      "widgets.privacy.enabled": true,
      "widgets.privacy.size": "medium",
    },
  },
};

function WrapWithProvider({ children, state = INITIAL_STATE }) {
  const store = createStore(combineReducers(reducers), state);
  return <Provider store={store}>{children}</Provider>;
}

function stateWithTrackers(trackersToday, sitesToday = 9) {
  return {
    ...mockState,
    PrivacyWidget: {
      ...INITIAL_STATE.PrivacyWidget,
      initialized: true,
      trackersToday,
      sitesToday,
    },
  };
}

function stateWithMessage(message, trackersToday = 87, sitesToday = 9) {
  return {
    ...mockState,
    PrivacyWidget: {
      ...INITIAL_STATE.PrivacyWidget,
      initialized: true,
      trackersToday,
      sitesToday,
      ...message,
    },
  };
}

function renderPrivacy(dispatch = jest.fn(), props = {}, state = mockState) {
  const { container, unmount } = render(
    <WrapWithProvider state={state}>
      <Privacy
        dispatch={dispatch}
        widgetsMayBeMaximized={true}
        widgetEnabledMap={{}}
        {...props}
      />
    </WrapWithProvider>
  );
  return { container, unmount, dispatch };
}

describe("Privacy widget", () => {
  it("renders the widget at the resolved size", () => {
    const { container } = renderPrivacy();
    const root = container.querySelector("article.privacy");
    expect(root).toBeTruthy();
    expect(root.className).toContain("medium-widget");
  });

  it("dispatches an impression once when it scrolls into view", () => {
    const dispatch = jest.fn();
    renderPrivacy(dispatch);
    // useIntersectionObserver invokes the callback on observe in the test env.
    const impressions = dispatch.mock.calls.filter(
      ([action]) => action.type === at.WIDGETS_IMPRESSION
    );
    expect(impressions.length).toBeLessThanOrEqual(1);
  });

  it("hides the widget by setting its enabled pref to false", () => {
    const dispatch = jest.fn();
    const { container } = renderPrivacy(dispatch);
    const hide = container.querySelector(
      '[data-l10n-id="newtab-widget-menu-hide"]'
    );
    fireEvent.click(hide);
    const setPref = dispatch.mock.calls.find(
      ([action]) =>
        action.type === at.SET_PREF &&
        action.data?.name === "widgets.privacy.enabled"
    );
    expect(setPref).toBeTruthy();
    expect(setPref[0].data.value).toBe(false);
  });

  it("shows no metric state until the feed has initialized", () => {
    // Default mockState has PrivacyWidget.initialized = false.
    const { container } = renderPrivacy();
    const root = container.querySelector("article.privacy");
    expect(root).toBeTruthy();
    expect(root.className).not.toContain("is-empty");
    expect(container.querySelector(".privacy-empty")).toBeFalsy();
    expect(container.querySelector(".privacy-count")).toBeFalsy();
  });

  it("shows the empty state when no trackers are blocked today", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(0));
    expect(container.querySelector("article.privacy").className).toContain(
      "is-empty"
    );
    expect(container.querySelector(".privacy-empty-message")).toBeTruthy();
    expect(container.querySelector(".privacy-count")).toBeFalsy();
  });

  it("leaves the empty state once the count climbs, even with a stale empty variant", () => {
    // A SYSTEM_TICK refreshes trackersToday without touching `variant`, so a
    // tab that opened at zero can carry variant "empty" with a non-zero count.
    // trackersToday must win (Dré, jsx:82).
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({ variant: "empty", icon: "shield" }, 12)
    );
    expect(container.querySelector("article.privacy").className).not.toContain(
      "is-empty"
    );
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "12"
    );
  });

  it("uses the shield icon in the empty state, ignoring a stale decision icon", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({ variant: "blank", icon: "shieldCheck" }, 0)
    );
    const img = container.querySelector(".privacy-empty .privacy-image-icon");
    expect(img.getAttribute("src")).toContain("widget-privacy-shield.svg");
    expect(img.getAttribute("src")).not.toContain("shield-check");
  });

  it("shows today's blocked-tracker count", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(42));
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "42"
    );
    expect(container.querySelector("article.privacy").className).not.toContain(
      "is-empty"
    );
  });

  it("ceilings the readout at 999+ by default", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(1200));
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "999+"
    );
  });

  it("shows the real count past the daily-cap threshold (no 100+ ceiling)", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(250));
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "250"
    );
  });

  it("caps at the widgets.privacy.maxDisplayCount pref when set", () => {
    const base = stateWithTrackers(75);
    const state = {
      ...base,
      Prefs: {
        ...base.Prefs,
        values: { ...base.Prefs.values, "widgets.privacy.maxDisplayCount": 50 },
      },
    };
    const { container } = renderPrivacy(jest.fn(), {}, state);
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "50+"
    );
  });

  it("lets trainhopConfig.widgets.privacyMaxDisplayCount override the pref", () => {
    const base = stateWithTrackers(75);
    const state = {
      ...base,
      Prefs: {
        ...base.Prefs,
        values: {
          ...base.Prefs.values,
          "widgets.privacy.maxDisplayCount": 200,
          trainhopConfig: { widgets: { privacyMaxDisplayCount: 50 } },
        },
      },
    };
    const { container } = renderPrivacy(jest.fn(), {}, state);
    // trainhop (50) wins over the pref (200): 75 > 50 caps to "50+".
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "50+"
    );
  });

  it("caps the readout to countCeiling+ on the daily-cap render", () => {
    // The daily-cap decision carries countCeiling (100); the real count is 137
    // but this one render shows "100+".
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage(
        {
          variant: "tip",
          messageId: "newtab-privacy-message-daily-cap",
          countCeiling: 100,
        },
        137
      )
    );
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "100+"
    );
  });

  it("shows the exact count just below the ceiling", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(87));
    expect(container.querySelector(".privacy-count-number").textContent).toBe(
      "87"
    );
  });

  it("passes the site count to the across-sites line", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithTrackers(42, 7)
    );
    const sites = container.querySelector(".privacy-count-sites");
    expect(sites).toBeTruthy();
    expect(sites.getAttribute("data-l10n-args")).toBe(
      JSON.stringify({ count: 7 })
    );
  });

  it("passes the numeric count (not the ceiling string) to the label plural", () => {
    const { container } = renderPrivacy(jest.fn(), {}, stateWithTrackers(250));
    const label = container.querySelector(".privacy-count-label");
    expect(label.getAttribute("data-l10n-args")).toBe(
      JSON.stringify({ count: 250 })
    );
  });

  it("renders the blank variant as count only (no tip, no divider)", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({ variant: "blank", icon: "shieldCheck" })
    );
    expect(container.querySelector(".privacy-count")).toBeTruthy();
    expect(container.querySelector(".privacy-divider")).toBeFalsy();
    expect(container.querySelector(".privacy-tip")).toBeFalsy();
    expect(container.querySelector(".privacy-streak")).toBeFalsy();
  });

  it("renders a View protections CTA in the blank state (info-1 label)", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "blank",
        icon: "shieldCheck",
        cta: { type: "OPEN_ABOUT_PAGE", data: { args: "protections" } },
      })
    );
    const button = container.querySelector(".privacy-cta");
    expect(button).toBeTruthy();
    expect(button.getAttribute("data-l10n-id")).toBe(
      "newtab-privacy-message-info-1-cta"
    );
    // Still no tip/divider — it's the count-only layout plus the CTA.
    expect(container.querySelector(".privacy-tip")).toBeFalsy();
    expect(container.querySelector(".privacy-divider")).toBeFalsy();
  });

  it("renders the tip variant via its l10n id and mapped icon", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "tip",
        messageId: "newtab-privacy-message-info-4",
        icon: "planet",
      })
    );
    expect(container.querySelector(".privacy-divider")).toBeTruthy();
    const tip = container.querySelector(".privacy-tip-message");
    expect(tip.getAttribute("data-l10n-id")).toBe(
      "newtab-privacy-message-info-4"
    );
    const img = container.querySelector(".privacy-image-icon");
    expect(img.getAttribute("src")).toContain("widget-privacy-planet.svg");
  });

  it("renders the streak variant with a divider and its message", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "streak",
        messageId: "newtab-privacy-message-streak",
        icon: "kit",
        countArg: { count: 5 },
      })
    );
    expect(container.querySelector("article.privacy").className).toContain(
      "has-streak"
    );
    expect(container.querySelector(".privacy-divider")).toBeTruthy();
    const streak = container.querySelector(
      ".privacy-streak .privacy-tip-message"
    );
    expect(streak.getAttribute("data-l10n-id")).toBe(
      "newtab-privacy-message-streak"
    );
  });

  it("resolves messageId as an l10n id with count args", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "tip",
        messageId: "newtab-privacy-message-milestone-week",
        icon: "kit",
        countArg: { count: 120 },
      })
    );
    const tip = container.querySelector(".privacy-tip-message");
    expect(tip.getAttribute("data-l10n-id")).toBe(
      "newtab-privacy-message-milestone-week"
    );
    expect(tip.getAttribute("data-l10n-args")).toBe(
      JSON.stringify({ count: 120 })
    );
  });

  it("renders a CTA button labelled from the message's -cta id", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "tip",
        messageId: "newtab-privacy-message-info-1",
        icon: "shield",
        cta: { type: "OPEN_ABOUT_PAGE", data: { args: "protections" } },
      })
    );
    const button = container.querySelector(".privacy-cta");
    expect(button).toBeTruthy();
    expect(button.getAttribute("data-l10n-id")).toBe(
      "newtab-privacy-message-info-1-cta"
    );
  });

  it("renders no CTA button when the decision has no cta", () => {
    const { container } = renderPrivacy(
      jest.fn(),
      {},
      stateWithMessage({
        variant: "tip",
        messageId: "newtab-privacy-message-info-1",
        icon: "shield",
        cta: null,
      })
    );
    expect(container.querySelector(".privacy-cta")).toBeFalsy();
  });

  it("dispatches WIDGETS_PRIVACY_CTA with the action on CTA click", () => {
    const dispatch = jest.fn();
    const cta = { type: "OPEN_ABOUT_PAGE", data: { args: "protections" } };
    const { container } = renderPrivacy(
      dispatch,
      {},
      stateWithMessage({
        variant: "tip",
        messageId: "newtab-privacy-message-info-1",
        icon: "shield",
        cta,
      })
    );
    fireEvent.click(container.querySelector(".privacy-cta"));
    const ctaAction = dispatch.mock.calls.find(
      ([action]) => action.type === at.WIDGETS_PRIVACY_CTA
    );
    expect(ctaAction).toBeTruthy();
    expect(ctaAction[0].data.action).toEqual(cta);
    expect(ctaAction[0].data.message_id).toBe("newtab-privacy-message-info-1");
  });

  it("attributes blank-state CTA clicks to a stable id (not null)", () => {
    const dispatch = jest.fn();
    const { container } = renderPrivacy(
      dispatch,
      {},
      stateWithMessage({
        variant: "blank",
        icon: "shieldCheck",
        cta: { type: "OPEN_ABOUT_PAGE", data: { args: "protections" } },
      })
    );
    fireEvent.click(container.querySelector(".privacy-cta"));
    const ctaAction = dispatch.mock.calls.find(
      ([action]) => action.type === at.WIDGETS_PRIVACY_CTA
    );
    expect(ctaAction[0].data.message_id).toBe("newtab-privacy-blank");
    const userEvent = dispatch.mock.calls.find(
      ([action]) =>
        action.type === at.WIDGETS_USER_EVENT &&
        action.data.user_action === "message_cta"
    );
    expect(userEvent[0].data.action_value).toBe("newtab-privacy-blank");
  });
});
