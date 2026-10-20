import type { NoteItem } from "../types/electron";
import type { CalendarAttendee } from "../types/calendar";
import type { MentionPerson } from "../utils/mentionMarkdown";
import { buildNoteRunInput } from "./templatePrompts";
import { isRegenerableNoteTitle } from "./regenerableNoteTitle";
import {
  collectKnownPeople,
  buildLlmTranscript,
  buildMeetingContext,
  type MeetingIdentity,
} from "../utils/llmTranscript";
import { parseTranscriptSegments } from "../utils/parseTranscriptSegments";
import { runBackgroundAction } from "../stores/actionProcessingStore";
import { resolveTemplate } from "../stores/actionStore";
import { usePolicyStore } from "../stores/policyStore";
import {
  getSettings,
  selectIsCloudNoteFormattingMode,
  selectPolicyEffectiveSettings,
  selectResolvedNoteFormatting,
} from "../stores/settingsStore";
import i18n from "../i18n";
import logger from "../utils/logger";

const makeContentHash = (content: string) => String(content.length) + "-" + content.slice(0, 50);

function parseNoteParticipants(raw: string | null | undefined): CalendarAttendee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Runs the note's AI Summary template after a meeting recording stops. Only
 * meeting notes with a transcript qualify, and an existing summary is kept
 * unless the note material changed since it was written.
 */
export async function autoSummarizeMeeting(noteId: number): Promise<boolean> {
  const settings = getSettings();
  if (!settings.autoSummarizeMeetings) return false;

  const note = (await window.electronAPI?.getNote(noteId)) as NoteItem | null;
  if (!note || note.note_type !== "meeting" || !note.transcript?.trim()) return false;

  const contentHash = makeContentHash(`${note.content}\n${note.transcript}`);
  if (note.enhanced_content?.trim() && note.enhanced_at_content_hash === contentHash) {
    return false;
  }

  const actions = (await window.electronAPI?.getActions?.()) ?? [];
  const template = resolveTemplate(actions, note.enhancement_template_id);
  if (!template) {
    logger.warn("Auto-summary skipped: no summary template", { noteId }, "meeting");
    return false;
  }

  const segments = parseTranscriptSegments(note.transcript);
  let formattedTranscript = "";
  let meetingContext = "";
  let knownPeople: MentionPerson[] = [];
  if (segments.length > 0) {
    const mappingRows = (await window.electronAPI?.getSpeakerMappings?.(note.id)) ?? [];
    const speakerMappings: Record<string, string> = {};
    for (const mapping of mappingRows) {
      speakerMappings[mapping.speaker_id] = mapping.display_name;
    }
    const identity: MeetingIdentity = {
      selfName: null,
      selfEmail: null,
      participants: parseNoteParticipants(note.participants),
    };
    const selfLabel = i18n.t("notes.speaker.you");
    meetingContext = buildMeetingContext(identity, selfLabel);
    formattedTranscript = buildLlmTranscript(segments, speakerMappings, selfLabel, i18n.t);
    knownPeople = collectKnownPeople(identity, speakerMappings, segments);
  }
  if (!formattedTranscript) formattedTranscript = note.transcript;

  const { input, fromSummary, material } = buildNoteRunInput(template, {
    summary: note.enhanced_content,
    notes: note.content,
    meetingContext,
    transcript: formattedTranscript,
  });

  const effectiveSettings = selectPolicyEffectiveSettings(getSettings(), usePolicyStore.getState());
  const isCloudMode = selectIsCloudNoteFormattingMode(effectiveSettings);
  const modelId = selectResolvedNoteFormatting(effectiveSettings).model;
  if (!isCloudMode && !modelId) {
    logger.info("Auto-summary skipped: no note formatting model configured", { noteId }, "meeting");
    return false;
  }
  runBackgroundAction(
    note.id,
    input,
    contentHash,
    template,
    {
      isCloudMode,
      modelId,
      isMeetingNote: true,
      knownPeople,
      fromSummary,
      material,
      allowTitleGeneration: isRegenerableNoteTitle(
        note.title,
        [
          i18n.t("notes.list.untitledNote"),
          i18n.t("notes.list.newNote"),
          i18n.t("notes.sidebar.newNote"),
        ],
        null
      ),
    },
    {
      noModel: i18n.t("notes.actions.errors.noModel"),
      noEndpoint: i18n.t("notes.actions.errors.noEndpoint"),
      actionFailed: i18n.t("notes.actions.errors.actionFailed"),
    }
  );

  logger.info("Auto-summary started after recording", { noteId }, "meeting");
  return true;
}
