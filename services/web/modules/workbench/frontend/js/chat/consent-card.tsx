import { ui } from '@modules/site-settings/frontend/js/ui'
/**
 * Asks for the AI terms once, with the core's consent text and hook.
 */
import { useTranslation } from "react-i18next";
import OLButton from "@/shared/components/ol/ol-button";
import useAiConsent from "@/shared/hooks/use-ai-consent";
import { ChatNotice } from "./notices";
import { useNoticeColors } from "./themed";

export default function ConsentCard() {
  const { t } = useTranslation();
  const { giveAiConsent, consentError } = useAiConsent();
  const notice = useNoticeColors();
  return (
    <div className="d-flex flex-column justify-content-end flex-grow-1">
      {consentError && (
        <ChatNotice
          type="error"
          text={t("failed_to_consent_to_workbench_terms")}
        />
      )}
      <section
        className="rounded p-3 d-flex flex-column gap-3"
        style={notice}
        aria-label={t("give-ai-consent")}
      >
        <div className="fw-bold">{ui("使用你选择的 AI 模型连接")}</div>
        <p className="mb-0">{ui(" 对话、图片和相关文件内容会发送到你选择的模型服务，由该服务处理。 ")}</p>
        <p className="mb-0">{ui(" 开启对话后，审阅论文并添加评论仍需另行确认。 ")}</p>
        <OLButton
          variant="primary"
          className="align-self-end"
          onClick={giveAiConsent}
        >
          {t("accept_and_continue")}
        </OLButton>
      </section>
    </div>
  );
}
