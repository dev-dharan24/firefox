/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// eslint-disable-next-line no-unused-vars
import React, { useCallback, useRef } from "react";
import { useSelector, batch } from "react-redux";
import { actionCreators as ac, actionTypes as at } from "common/Actions.mjs";
import { useIntersectionObserver, useSizeSubmenu } from "../../../lib/utils";
import {
  WIDGET_REGISTRY,
  resolveWidgetSize,
  resolvePrivacyDisplayCount,
} from "common/WidgetsRegistry.mjs";
import { MoveSubmenu } from "../MoveSubmenu";

const USER_ACTION_TYPES = {
  CHANGE_SIZE: "change_size",
};

const PRIVACY_ENTRY = WIDGET_REGISTRY.find(w => w.id === "privacy");

const ICON_BASE_URL = "chrome://newtab/content/data/content/assets/";

// Icon key (from the message decision / PrivacyMessages.sys.mjs) -> asset.
const ICON_ASSETS = {
  shield: "widget-privacy-shield.svg",
  shieldCheck: "widget-privacy-shield-check.svg",
  planet: "widget-privacy-planet.svg",
  bolt: "widget-privacy-bolt.svg",
  star: "widget-privacy-star.svg",
  kit: "widget-privacy-kit.svg",
};

// Renders a widget icon by icon key. The wrapper div is the alignment hook.
const privacyImage = iconKey => (
  <div className="privacy-image">
    <img
      className="privacy-image-icon"
      src={`${ICON_BASE_URL}${ICON_ASSETS[iconKey] || ICON_ASSETS.shieldCheck}`}
      alt=""
    />
  </div>
);

function Privacy({ dispatch, widgetsMayBeMaximized, widgetEnabledMap }) {
  const prefs = useSelector(state => state.Prefs.values);
  const privacyData = useSelector(state => state.PrivacyWidget);

  // Size comes from the registry helper: user-set pref > trainhop suggestion
  // > registry defaultSize. Never read the size pref directly.
  const widgetSize = resolveWidgetSize(PRIVACY_ENTRY, prefs);
  const impressionFired = useRef(false);

  const trackersToday = privacyData?.trackersToday ?? 0;
  const sitesToday = privacyData?.sitesToday ?? 0;
  // Gate the metric UI on a real feed update. Before the first broadcast — or
  // when it's skipped (e.g. the backward-compat guard in PrivacyFeed on older
  // platforms) — show no metric state rather than a misleading empty/zero one.
  const initialized = privacyData?.initialized ?? false;

  // Message decision chosen by PrivacyFeed's selector (Bug 2050954).
  const { variant, messageId, icon, countArg, cta, countCeiling } =
    privacyData ?? {};
  const isLarge = widgetSize === "large";

  // Normally show the real count, only ceiling the readout at "{cap}+"
  // (default 999) so it stays a tidy few characters. On the daily-cap render
  // the selector sets countCeiling (100), so that one load shows "100+"; the
  // next load clears it and the real number returns.
  const displayCap = resolvePrivacyDisplayCount(prefs);
  let displayCount = `${trackersToday}`;
  if (typeof countCeiling === "number") {
    displayCount = `${countCeiling}+`;
  } else if (trackersToday > displayCap) {
    displayCount = `${displayCap}+`;
  }

  // trackersToday === 0 is the sole trigger for the empty layout. It must not
  // also key off `variant === "empty"`: a SYSTEM_TICK refreshes the count
  // without touching `variant`, so a tab opened at zero would stay empty even
  // after its count climbs, until the next tab re-runs the selector.
  const isEmptyState = trackersToday === 0;
  // Streak and tip both use the count + divider + message layout; "blank"
  // shows the count only (plus a CTA).
  const isStreak = !isEmptyState && variant === "streak";
  const isTip = !isEmptyState && variant === "tip";
  const isBlank = !isEmptyState && variant === "blank";
  const hasMessage = (isStreak || isTip) && messageId;
  // Telemetry id for a CTA click. The blank state has no messageId, so give it
  // a stable, distinguishable id — otherwise its clicks report null and the
  // most-shown state can't be attributed (Dré).
  const ctaMessageId = isBlank ? "newtab-privacy-blank" : messageId;
  // The single icon sits beside the count, except in the large tip layout where
  // it sits inside the tip.
  const iconBesideCount = !isEmptyState && !(isTip && isLarge);
  const iconInTip = isTip && isLarge;

  const handleIntersection = useCallback(() => {
    if (impressionFired.current) {
      return;
    }
    impressionFired.current = true;
    dispatch(
      ac.AlsoToMain({
        type: at.WIDGETS_IMPRESSION,
        data: {
          widget_name: "privacy",
          widget_size: widgetSize,
        },
      })
    );
  }, [dispatch, widgetSize]);

  const widgetRef = useIntersectionObserver(handleIntersection);

  function handlePrivacyHide() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.SET_PREF,
          data: { name: PRIVACY_ENTRY.enabledPref, value: false },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_ENABLED,
          data: {
            widget_name: "privacy",
            widget_source: "context_menu",
            enabled: false,
            widget_size: widgetSize,
          },
        })
      );
    });
  }

  const handleChangeSize = useCallback(
    size => {
      batch(() => {
        dispatch(
          ac.OnlyToMain({
            type: at.SET_PREF,
            data: { name: PRIVACY_ENTRY.sizePref, value: size },
          })
        );
        dispatch(
          ac.OnlyToMain({
            type: at.WIDGETS_USER_EVENT,
            data: {
              widget_name: "privacy",
              widget_source: "context_menu",
              user_action: USER_ACTION_TYPES.CHANGE_SIZE,
              action_value: size,
              widget_size: size,
            },
          })
        );
      });
    },
    [dispatch]
  );

  const sizeSubmenuRef = useSizeSubmenu(handleChangeSize);

  function handleLearnMore() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.OPEN_LINK,
          data: {
            url: "https://support.mozilla.org/kb/firefox-new-tab-widgets",
          },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "privacy",
            widget_source: "context_menu",
            user_action: "learn_more",
            widget_size: widgetSize,
          },
        })
      );
    });
  }

  // Runs the message's CTA. The SpecialMessageAction descriptor lives on the
  // decision (`cta`); the parent (PrivacyFeed) executes it — content only
  // forwards it and logs the interaction.
  function handleCtaClick() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_PRIVACY_CTA,
          data: { action: cta, message_id: ctaMessageId },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "privacy",
            widget_source: "widget",
            user_action: "message_cta",
            action_value: ctaMessageId,
            widget_size: widgetSize,
          },
        })
      );
    });
  }

  // The message resolves via its Fluent `messageId` (Bug 2048389); `countArg`
  // feeds the plural/variable l10n args.
  const messageEl = className => (
    <p
      className={className}
      data-l10n-id={messageId}
      data-l10n-args={countArg ? JSON.stringify(countArg) : undefined}
    />
  );

  // CTA button for messages that carry one (`cta`); its label is the message's
  // `-cta` companion Fluent id. Value-only messages render as moz-button text.
  const ctaButton =
    cta && messageId ? (
      <moz-button
        className="privacy-cta"
        data-l10n-id={`${messageId}-cta`}
        onClick={handleCtaClick}
        size="small"
        type="primary"
      />
    ) : null;

  // The blank state has no tip copy (messageId is null) but still shows a
  // "View protections" CTA, borrowing info-1's companion label for now.
  const blankCta =
    isBlank && cta ? (
      <moz-button
        className="privacy-cta"
        data-l10n-id="newtab-privacy-message-info-1-cta"
        onClick={handleCtaClick}
        size="small"
        type="primary"
      />
    ) : null;

  return (
    <article
      className={`privacy widget col-4 ${widgetSize}-widget${
        initialized && isEmptyState ? " is-empty" : ""
      }${initialized && isTip ? " has-tip-msg" : ""}${
        initialized && isStreak ? " has-streak" : ""
      }`}
      ref={el => {
        widgetRef.current = [el];
      }}
    >
      <div className="privacy-title-wrapper">
        <div className="privacy-context-menu-wrapper">
          <moz-button
            className="privacy-context-menu-button"
            iconSrc="chrome://global/skin/icons/more.svg"
            menuId="privacy-context-menu"
            type="ghost"
          />
          <panel-list id="privacy-context-menu">
            {widgetsMayBeMaximized && (
              <panel-item submenu="privacy-size-submenu">
                <span data-l10n-id="newtab-widget-menu-change-size"></span>
                <panel-list
                  ref={sizeSubmenuRef}
                  slot="submenu"
                  id="privacy-size-submenu"
                >
                  {["medium", "large"].map(size => (
                    <panel-item
                      key={size}
                      type="checkbox"
                      checked={widgetSize === size || undefined}
                      data-size={size}
                      data-l10n-id={`newtab-widget-size-${size}`}
                    />
                  ))}
                </panel-list>
              </panel-item>
            )}

            <MoveSubmenu
              widgetId="privacy"
              widgetEnabledMap={widgetEnabledMap}
            />

            <panel-item
              data-l10n-id="newtab-widget-menu-hide"
              onClick={handlePrivacyHide}
            />
            <panel-item
              data-l10n-id="newtab-privacy-menu-learn-more"
              onClick={handleLearnMore}
            />
          </panel-list>
        </div>
      </div>

      <div className="privacy-body">
        {initialized &&
          (isEmptyState ? (
            <div className="privacy-empty">
              {/* Empty state always uses the shield icon — never the decision's
                  `icon`, which may be a stale shieldCheck from a prior tip. */}
              {privacyImage("shield")}
              <p
                className="privacy-empty-message"
                data-l10n-id="newtab-privacy-empty"
              />
            </div>
          ) : (
            <>
              <div className="privacy-count">
                <div className="privacy-count-number-wrapper">
                  {/* The single icon sits beside the count, except in the large
                      tip layout where it moves into the tip. */}
                  {iconBesideCount && privacyImage(icon || "shieldCheck")}
                  <span className="privacy-count-number">{displayCount}</span>
                </div>

                <div className="privacy-count-text">
                  <span
                    className="privacy-count-label"
                    data-l10n-id="newtab-privacy-trackers-blocked-today"
                    data-l10n-args={JSON.stringify({ count: trackersToday })}
                  />
                  <span
                    className="privacy-count-sites"
                    data-l10n-id="newtab-privacy-across-sites"
                    data-l10n-args={JSON.stringify({ count: sitesToday })}
                  />
                </div>
              </div>
              {isStreak && hasMessage && (
                <>
                  <hr className="privacy-divider" />
                  <div className="privacy-streak">
                    {messageEl("privacy-tip-message")}
                    {ctaButton}
                  </div>
                </>
              )}
              {isTip && hasMessage && (
                <>
                  <hr className="privacy-divider" />
                  <div className="privacy-tip">
                    {iconInTip && privacyImage(icon || "shieldCheck")}
                    <div className="privacy-tip-content">
                      {messageEl("privacy-tip-message")}
                      {ctaButton}
                    </div>
                  </div>
                </>
              )}
              {/* Blank: count only, but still a "View protections" CTA. */}
              {blankCta}
            </>
          ))}
      </div>
    </article>
  );
}

export { Privacy };
