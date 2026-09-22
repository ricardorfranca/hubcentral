/**
 * @file CustomFieldsEditor.tsx
 * @module modules/contacts
 *
 * Editor dos valores de campos personalizados de um contato (pessoa ou
 * empresa). Fino wrapper sobre o editor genérico em `core/ui`, mantendo a API
 * histórica (`contactId`) usada pelos diálogos de pessoa e empresa.
 */

import {
  CustomFieldsEditor as GenericCustomFieldsEditor,
  type FieldFeedback,
} from "../../core/ui/CustomFieldsEditor.js";

export type { FieldFeedback };

/**
 * Editor dos valores de campos personalizados de um contato.
 *
 * @param props - `contactId` do contato e callback de feedback.
 * @returns O editor de campos personalizados.
 */
export function CustomFieldsEditor({
  contactId, onFeedback,
}: {
  contactId: string; onFeedback: (f: FieldFeedback) => void;
}): JSX.Element {
  return <GenericCustomFieldsEditor entity="contact" entityId={contactId} onFeedback={onFeedback} />;
}
