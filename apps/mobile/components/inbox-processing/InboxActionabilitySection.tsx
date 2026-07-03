import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { QuickDatePreset } from '@mindwtr/core';

import { styles } from '../inbox-processing-modal.styles';
import { InboxDateSelectorRow } from './InboxDateSelectorRow';
import { EmojiLabel } from '../ui/emoji-label';
import type { ThemeColors } from '@/hooks/use-theme-colors';

type ActionabilityChoice = 'actionable' | 'later' | 'trash' | 'someday' | 'reference';

type Props = {
  t: (key: string) => string;
  tc: ThemeColors;
  actionabilityChoice: ActionabilityChoice;
  setActionabilityChoice: (v: ActionabilityChoice) => void;
  referenceEnabled: boolean;
  laterLabel: string;
  laterHint: string;
  dateOnlyLabel: string;
  pendingStartDate: Date | null;
  laterNoDateSelected: boolean;
  setPendingStartDate: (v: Date | null) => void;
  setLaterNoDateSelected: (v: boolean) => void;
  pendingStartDateOnly: boolean;
  setPendingStartDateOnly: (v: boolean) => void;
  setShowStartDatePicker: (v: boolean) => void;
  defaultScheduleTime?: string | null;
};

export function InboxActionabilitySection({
  t,
  tc,
  actionabilityChoice,
  setActionabilityChoice,
  referenceEnabled,
  laterLabel,
  laterHint,
  dateOnlyLabel,
  pendingStartDate,
  laterNoDateSelected,
  setPendingStartDate,
  setLaterNoDateSelected,
  pendingStartDateOnly,
  setPendingStartDateOnly,
  setShowStartDatePicker,
  defaultScheduleTime,
}: Props) {
  const chooseActionability = (choice: ActionabilityChoice) => {
    setActionabilityChoice(choice);
    if (choice !== 'later') {
      setLaterNoDateSelected(false);
    }
  };

  return (
    <>
      <View style={[styles.singleSection, { borderBottomColor: tc.border }]}>
        <Text style={[styles.stepQuestion, { color: tc.text }]}>
          {t('inbox.isActionable')}
        </Text>
        <Text style={[styles.stepHint, { color: tc.secondaryText }]}>
          {t('inbox.actionableHint')}
        </Text>
        <View style={styles.buttonColumn}>
          <TouchableOpacity
            style={[
              styles.bigButton,
              actionabilityChoice === 'actionable' ? styles.buttonPrimary : { backgroundColor: tc.border },
            ]}
            onPress={() => chooseActionability('actionable')}
          >
            <EmojiLabel emoji="✅" label={t('inbox.yesActionable')} textStyle={[styles.bigButtonText, actionabilityChoice !== 'actionable' && { color: tc.text }]} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.bigButton,
              actionabilityChoice === 'later' ? styles.buttonPrimary : { backgroundColor: tc.border },
            ]}
            onPress={() => chooseActionability('later')}
          >
            <EmojiLabel emoji="🕒" label={laterLabel} textStyle={[styles.bigButtonText, actionabilityChoice !== 'later' && { color: tc.text }]} />
          </TouchableOpacity>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: actionabilityChoice === 'trash' ? '#EF4444' : tc.border }]}
              onPress={() => chooseActionability('trash')}
            >
              <EmojiLabel emoji="🗑️" label={t('inbox.trash')} textStyle={[styles.buttonPrimaryText, actionabilityChoice !== 'trash' && { color: tc.text }]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: actionabilityChoice === 'someday' ? '#8B5CF6' : tc.border }]}
              onPress={() => chooseActionability('someday')}
            >
              <EmojiLabel emoji="💭" label={t('inbox.someday')} textStyle={[styles.buttonPrimaryText, actionabilityChoice !== 'someday' && { color: tc.text }]} />
            </TouchableOpacity>
            {referenceEnabled && (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: actionabilityChoice === 'reference' ? '#3B82F6' : tc.border }]}
                onPress={() => chooseActionability('reference')}
              >
                <EmojiLabel emoji="📚" label={t('nav.reference')} textStyle={[styles.buttonPrimaryText, actionabilityChoice !== 'reference' && { color: tc.text }]} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {actionabilityChoice === 'later' && (
        <View style={[styles.singleSection, { borderBottomColor: tc.border }]}>
          <Text style={[styles.stepQuestion, { color: tc.text }]}>{laterLabel}</Text>
          <Text style={[styles.stepHint, { color: tc.secondaryText }]}>{laterHint}</Text>
          <InboxDateSelectorRow
            t={t}
            label={t('taskEdit.startDateLabel')}
            value={pendingStartDate}
            selectedPreset={laterNoDateSelected ? 'no_date' : null}
            onOpen={() => setShowStartDatePicker(true)}
            onClear={() => {
              setPendingStartDate(null);
              setPendingStartDateOnly(false);
              setLaterNoDateSelected(false);
            }}
            onQuickDateSelect={(date, preset: QuickDatePreset) => {
              setPendingStartDate(date);
              setPendingStartDateOnly(false);
              setLaterNoDateSelected(preset === 'no_date' ? !laterNoDateSelected : false);
            }}
            dateOnly={pendingStartDateOnly}
            onDateOnly={() => setPendingStartDateOnly(true)}
            onUseDefaultTime={() => setPendingStartDateOnly(false)}
            defaultScheduleTime={defaultScheduleTime}
            dateOnlyLabel={dateOnlyLabel}
            notSetLabel={t('common.notSet')}
            clearLabel={t('common.clear')}
            tc={tc}
          />
        </View>
      )}
    </>
  );
}
