import { SendSurveyQuestionParams } from "../flow.types"
import { sendWhatsAppList, sendWhatsAppMessage, sendWhatsAppSurvey } from "../whatsapp-client"



export async function sendSurveyQuestion({
  to,
  session,
  question,
}: SendSurveyQuestionParams) {

    if (!session) {
        console.error("❌ Missing session in sendSurveyQuestion")
        return false
    }

    const index = session.current_question;
    const total = session.total_questions;

    const headerText =
        index === 0 ? `📊 FBNBank Survey\n💡 Type exit anytime to stop the survey.` : undefined;

    const footerText = `Question ${index + 1} of ${total}`;

    const qText = question.text ?? question.question;
    if (!qText) return false;

    // BUTTON
    if (question.type === 'button' && question.options?.length) {
        return sendWhatsAppSurvey({
        to,
        question: qText,
        options: question.options.map((opt, i) => ({
            id: `${session.id}_q${index + 1}_opt${i + 1}`,
            title: opt,
        })),
        headerText,
        footerText,
        });
    }

    // LIST
    if (question.type === 'list' && question.options?.length) {
        return sendWhatsAppList({
        to,
        headerText,
        bodyText: qText,
        footerText,
        buttonText: 'Select',
        sections: [
            {
            title: question.sectionTitle || 'Options',
            rows: question.options.map((opt, i) => ({
                id: `${session.id}_q${index + 1}_opt${i + 1}`,
                title: opt,
            })),
            },
        ],
        });
    }

    // TEXT (FIXED)
    return sendWhatsAppMessage({
        to,
        message: `${qText}\n\n${footerText}\n(Reply with your answer)`,
    });
}
