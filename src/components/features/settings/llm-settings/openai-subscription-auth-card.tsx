import React from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LLMSubscriptionDeviceChallenge } from "#/api/llm-subscription-service";
import LLMSubscriptionService from "#/api/llm-subscription-service";
import { BrandButton } from "#/components/features/settings/brand-button";
import { CopyToClipboardButton } from "#/components/shared/buttons/copy-to-clipboard-button";
import {
  useLogoutOpenAISubscription,
  usePollOpenAISubscriptionLogin,
  useStartOpenAISubscriptionLogin,
} from "#/hooks/mutation/use-llm-subscription-auth";
import { useOpenAISubscriptionStatus } from "#/hooks/query/use-llm-subscription-status";
import { LLM_SUBSCRIPTION_QUERY_KEYS } from "#/hooks/query/query-keys";
import { I18nKey } from "#/i18n/declaration";
import { Typography } from "#/ui/typography";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";

const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;
const MIN_DEVICE_POLL_INTERVAL_SECONDS = 1;

interface OpenAISubscriptionAuthCardProps {
  isDisabled?: boolean;
}

function openVerificationUrl(challenge: LLMSubscriptionDeviceChallenge) {
  const url = challenge.verificationUriComplete ?? challenge.verificationUri;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function OpenAISubscriptionAuthCard({
  isDisabled = false,
}: OpenAISubscriptionAuthCardProps) {
  const { t } = useTranslation("openhands");
  const queryClient = useQueryClient();
  const oidcUser = useQuery({
    queryKey: ["oidc-user-status"],
    queryFn: LLMSubscriptionService.getOIDCUser,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const isAdmin = Boolean(oidcUser.data?.isAdmin);
  const grants = useQuery({
    queryKey: ["openai-shared-grants"],
    queryFn: LLMSubscriptionService.getOpenAISharedGrants,
    enabled: isAdmin,
    retry: false,
  });
  const updateGrant = useMutation({
    mutationFn: ({ sub, enabled }: { sub: string; enabled: boolean }) =>
      LLMSubscriptionService.setOpenAISharedGrant(sub, enabled),
    onSuccess: (users) =>
      queryClient.setQueryData(["openai-shared-grants"], users),
  });
  const updateSource = useMutation({
    mutationFn: LLMSubscriptionService.setOpenAICredentialSource,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: LLM_SUBSCRIPTION_QUERY_KEYS.openaiStatus,
      }),
    onError: () => displayErrorToast(t(I18nKey.ERROR$GENERIC)),
  });
  const status = useOpenAISubscriptionStatus();
  const startLogin = useStartOpenAISubscriptionLogin();
  const pollLogin = usePollOpenAISubscriptionLogin();
  const logout = useLogoutOpenAISubscription();
  const [challenge, setChallenge] =
    React.useState<LLMSubscriptionDeviceChallenge | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [isPendingLogin, setIsPendingLogin] = React.useState(false);
  const [grantSub, setGrantSub] = React.useState("");
  const pollTimeoutRef = React.useRef<number | null>(null);

  const clearPollTimeout = React.useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const handleCopyCode = () => {
    if (!challenge) return;
    navigator.clipboard.writeText(challenge.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isBusy =
    startLogin.isPending ||
    pollLogin.isPending ||
    logout.isPending ||
    updateSource.isPending;
  const connected = Boolean(status.data?.connected);
  const activeCredentialConnected =
    status.data?.credentialSource === "shared"
      ? Boolean(status.data.sharedConnected)
      : connected;

  const pollDeviceLogin = React.useCallback(
    async (deviceCode: string) => {
      try {
        const nextStatus = await pollLogin.mutateAsync(deviceCode);
        if (nextStatus.connected) {
          setChallenge(null);
          setIsPendingLogin(false);
          displaySuccessToast(t(I18nKey.SETTINGS$SUBSCRIPTION_CONNECTED_TOAST));
          return true;
        }
        setIsPendingLogin(true);
        return false;
      } catch {
        displayErrorToast(t(I18nKey.SETTINGS$SUBSCRIPTION_CONNECT_ERROR));
        return true;
      }
    },
    [pollLogin, t],
  );

  React.useEffect(() => {
    if (!challenge || connected || isDisabled) {
      return undefined;
    }

    let cancelled = false;
    const intervalSeconds = Math.max(
      challenge.intervalSeconds ?? DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
      MIN_DEVICE_POLL_INTERVAL_SECONDS,
    );

    const schedulePoll = () => {
      clearPollTimeout();
      pollTimeoutRef.current = window.setTimeout(async () => {
        if (cancelled) {
          return;
        }

        const shouldStop = await pollDeviceLogin(challenge.deviceCode);
        if (!cancelled && !shouldStop) {
          schedulePoll();
        }
      }, intervalSeconds * 1000);
    };

    schedulePoll();

    return () => {
      cancelled = true;
      clearPollTimeout();
    };
  }, [challenge, clearPollTimeout, connected, isDisabled, pollDeviceLogin]);

  const handleStartLogin = async () => {
    try {
      const nextChallenge = await startLogin.mutateAsync();
      setChallenge(nextChallenge);
      setIsPendingLogin(true);
      openVerificationUrl(nextChallenge);
    } catch {
      displayErrorToast(t(I18nKey.SETTINGS$SUBSCRIPTION_CONNECT_ERROR));
    }
  };

  const handlePollLogin = async () => {
    if (!challenge) return;
    clearPollTimeout();
    void pollDeviceLogin(challenge.deviceCode);
  };

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      clearPollTimeout();
      setChallenge(null);
      setIsPendingLogin(false);
      displaySuccessToast(t(I18nKey.SETTINGS$SUBSCRIPTION_DISCONNECTED_TOAST));
    } catch {
      displayErrorToast(t(I18nKey.ERROR$GENERIC));
    }
  };

  const handleCancelLogin = () => {
    clearPollTimeout();
    setChallenge(null);
    setIsPendingLogin(false);
  };

  return (
    <section
      data-testid="openai-subscription-auth-card"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <div className="flex flex-col gap-2">
        <Typography.H3>
          {t(I18nKey.SETTINGS$SUBSCRIPTION_CARD_TITLE)}
        </Typography.H3>
        <Typography.Paragraph className="text-tertiary-alt text-sm leading-5">
          {t(I18nKey.SETTINGS$SUBSCRIPTION_CARD_DESCRIPTION)}
        </Typography.Paragraph>
      </div>

      <div
        className="flex flex-col gap-1 text-sm"
        data-testid="subscription-status"
      >
        {status.isLoading ? (
          <span className="text-tertiary-light">
            {t(I18nKey.SETTINGS$SUBSCRIPTION_STATUS_CHECKING)}
          </span>
        ) : status.isError ? (
          <span className="text-danger">
            {t(I18nKey.SETTINGS$SUBSCRIPTION_STATUS_UNAVAILABLE)}
          </span>
        ) : activeCredentialConnected ? (
          <>
            <span className="text-success">
              {t(I18nKey.SETTINGS$SUBSCRIPTION_STATUS_CONNECTED)}
            </span>
            {status.data?.accountEmail &&
            (isAdmin || status.data.credentialSource !== "shared") ? (
              <span className="text-tertiary-light">
                {t(I18nKey.SETTINGS$SUBSCRIPTION_ACCOUNT, {
                  account: status.data.accountEmail,
                })}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-warning">
            {t(I18nKey.SETTINGS$SUBSCRIPTION_STATUS_DISCONNECTED)}
          </span>
        )}
      </div>

      {oidcUser.data?.sub ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-tertiary-light">
            {t(I18nKey.SETTINGS$SUBSCRIPTION_ACCOUNT_ID)}
          </span>
          <code className="break-all">{oidcUser.data.sub}</code>
          <CopyToClipboardButton
            isHidden={false}
            isDisabled={false}
            onClick={() => navigator.clipboard.writeText(oidcUser.data!.sub!)}
            mode="copy"
          />
        </div>
      ) : null}

      {status.data?.sharedAvailable && !isAdmin ? (
        <div className="flex flex-col gap-2">
          <Typography.Paragraph className="text-tertiary-alt text-sm leading-5">
            {t(I18nKey.SETTINGS$SUBSCRIPTION_SHARED_AVAILABLE)}
          </Typography.Paragraph>
          <div className="flex flex-wrap gap-2">
            <BrandButton
              type="button"
              variant={
                status.data.credentialSource === "personal"
                  ? "primary"
                  : "secondary"
              }
              isDisabled={updateSource.isPending}
              onClick={() => updateSource.mutate("personal")}
            >
              {t(I18nKey.SETTINGS$SUBSCRIPTION_USE_PERSONAL)}
            </BrandButton>
            <BrandButton
              type="button"
              variant={
                status.data.credentialSource === "shared"
                  ? "primary"
                  : "secondary"
              }
              isDisabled={updateSource.isPending}
              onClick={() => updateSource.mutate("shared")}
            >
              {t(I18nKey.SETTINGS$SUBSCRIPTION_USE_SHARED)}
            </BrandButton>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <Typography.H3>
            {t(I18nKey.SETTINGS$SUBSCRIPTION_SHARED_ACCESS)}
          </Typography.H3>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={t(I18nKey.SETTINGS$SUBSCRIPTION_ACCOUNT_ID)}
              className="min-w-64 flex-1 rounded border border-border bg-surface-deep px-3 py-2 text-sm"
              value={grantSub}
              onChange={(event) => setGrantSub(event.target.value)}
              placeholder={t(I18nKey.SETTINGS$SUBSCRIPTION_ACCOUNT_ID)}
            />
            <BrandButton
              type="button"
              variant="secondary"
              isDisabled={!grantSub.trim() || updateGrant.isPending}
              onClick={() => {
                updateGrant.mutate(
                  { sub: grantSub.trim(), enabled: true },
                  {
                    onSuccess: () => setGrantSub(""),
                    onError: () => displayErrorToast(t(I18nKey.ERROR$GENERIC)),
                  },
                );
              }}
            >
              {t(I18nKey.SETTINGS$SUBSCRIPTION_GRANT)}
            </BrandButton>
          </div>
          {grants.data?.map((sub) => (
            <div
              key={sub}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <code className="break-all">{sub}</code>
              <BrandButton
                type="button"
                variant="tertiary"
                isDisabled={updateGrant.isPending}
                onClick={() =>
                  updateGrant.mutate(
                    { sub, enabled: false },
                    {
                      onError: () =>
                        displayErrorToast(t(I18nKey.ERROR$GENERIC)),
                    },
                  )
                }
              >
                {t(I18nKey.SETTINGS$SUBSCRIPTION_REVOKE)}
              </BrandButton>
            </div>
          ))}
        </div>
      ) : null}

      {challenge ? (
        <div
          data-testid="subscription-device-challenge"
          className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3 text-sm"
        >
          <span>{t(I18nKey.SETTINGS$SUBSCRIPTION_DEVICE_INSTRUCTIONS)}</span>
          <div className="flex items-center gap-2 rounded-lg bg-surface-deep px-3 py-2 font-mono text-base font-semibold text-contrast">
            <span
              data-testid="subscription-user-code"
              className="flex-1 select-all tracking-[0.08em]"
            >
              {challenge.userCode}
            </span>
            <CopyToClipboardButton
              isHidden={false}
              isDisabled={false}
              onClick={handleCopyCode}
              mode={copied ? "copied" : "copy"}
            />
          </div>
          <a
            href={
              challenge.verificationUriComplete ?? challenge.verificationUri
            }
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-accent underline"
          >
            {t(I18nKey.SETTINGS$SUBSCRIPTION_OPEN_LOGIN)}
            <ExternalLink size={14} aria-hidden />
          </a>
          {isPendingLogin ? (
            <span className="text-warning">
              {t(I18nKey.SETTINGS$SUBSCRIPTION_PENDING_TOAST)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {connected ? (
          <BrandButton
            testId="subscription-disconnect"
            type="button"
            variant="tertiary"
            isDisabled={isDisabled || isBusy}
            onClick={handleLogout}
          >
            {t(I18nKey.SETTINGS$SUBSCRIPTION_DISCONNECT)}
          </BrandButton>
        ) : (
          <BrandButton
            testId="subscription-connect"
            type="button"
            variant="primary"
            isDisabled={isDisabled || isBusy}
            onClick={handleStartLogin}
          >
            {t(I18nKey.SETTINGS$SUBSCRIPTION_CONNECT)}
          </BrandButton>
        )}

        {challenge ? (
          <>
            <BrandButton
              testId="subscription-poll"
              type="button"
              variant="secondary"
              isDisabled={isDisabled || isBusy}
              onClick={handlePollLogin}
            >
              {t(I18nKey.SETTINGS$SUBSCRIPTION_FINISH_SIGN_IN)}
            </BrandButton>
            <BrandButton
              testId="subscription-cancel"
              type="button"
              variant="tertiary"
              isDisabled={isDisabled || isBusy}
              onClick={handleCancelLogin}
            >
              {t(I18nKey.BUTTON$CANCEL)}
            </BrandButton>
          </>
        ) : null}
      </div>
    </section>
  );
}
