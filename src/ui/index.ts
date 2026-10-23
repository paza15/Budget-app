/**
 * The UI kit (docs/SPEC.md §5.8): typed, accessible primitives styled only with tokens. It never
 * imports the store; money settings come from MoneyFormatContext. Charts live in '@/ui/charts'.
 */

export { AmountDisplay, keypadFigure, type AmountDisplayProps, type KeypadFigure } from '@/ui/AmountDisplay'
export { AmountField, plainAmount, type AmountFieldProps } from '@/ui/AmountField'
export { Banner, type BannerAction, type BannerProps, type BannerTone } from '@/ui/Banner'
export { BigAmount, type BigAmountProps } from '@/ui/BigAmount'
export { Button, type ButtonProps } from '@/ui/Button'
export { CategoryBadge, type CategoryBadgeProps } from '@/ui/CategoryBadge'
export { CategoryIcon, isEmojiIcon, type CategoryIconProps } from '@/ui/CategoryIcon'
export { Chip, type ChipProps } from '@/ui/Chip'
export { ChipTabs, type ChipTabItem, type ChipTabsProps } from '@/ui/ChipTabs'
export { Coin, COIN_GLYPH_SIZE, type CoinProps, type CoinSize } from '@/ui/Coin'
export { ColorSwatches, type ColorSwatchesProps, type ColorSwatchOption } from '@/ui/ColorSwatches'
export { ConfirmHost } from '@/ui/ConfirmHost'
export { ConsequenceLine, type ConsequenceLineProps } from '@/ui/ConsequenceLine'
export {
  chooseDialog,
  confirmDialog,
  type ChooseOption,
  type ChooseOptions,
  type ConfirmOptions,
} from '@/ui/dialogs'
export { EmojiPicker, type EmojiPickerProps } from '@/ui/EmojiPicker'
export { EmptyState, type EmptyStateProps } from '@/ui/EmptyState'
export { Engraving, type EngravingKind, type EngravingProps } from '@/ui/Engraving'
export { Icon, type IconProps } from '@/ui/Icon'
export { GlassGroup, IconButton, type GlassGroupProps, type IconButtonProps } from '@/ui/IconButton'
export { IconPicker, type IconPickerProps } from '@/ui/IconPicker'
export { UI_ICON_NAMES, type IconWeight, type UiIconName } from '@/ui/icons/manifest'
export { Keypad, type KeypadProps } from '@/ui/Keypad'
export { LedgerFigure, type LedgerFigureProps } from '@/ui/LedgerFigure'
export { ListRow, type ListRowProps } from '@/ui/ListRow'
export { MaskedText } from '@/ui/MaskedText'
export { Meter, type MeterProps } from '@/ui/Meter'
export { MASKED_LABEL, Money, type MoneyProps } from '@/ui/Money'
export { MoneyFormatContext, useMoneyFormatContext } from '@/ui/MoneyFormatContext'
export { Monogram, type MonogramProps } from '@/ui/Monogram'
export { PaidCheck, type PaidCheckProps } from '@/ui/PaidCheck'
export { Screen, type ScreenProps } from '@/ui/Screen'
export { Section, type SectionLink, type SectionProps } from '@/ui/Section'
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from '@/ui/SegmentedControl'
export { SelectField, type SelectFieldProps, type SelectOption } from '@/ui/SelectField'
export { Sheet, type ModalSheetProps } from '@/ui/Sheet'
export { SheetHeader, type SheetHeaderAction, type SheetHeaderProps } from '@/ui/SheetHeader'
export { emojiFromInput, firstGrapheme, withTrueMinus } from '@/ui/text'
export { toast, type ToastAction, type ToastHandle, type ToastOptions } from '@/ui/toast'
export { ToastHost } from '@/ui/ToastHost'
export { TextField, type TextFieldProps } from '@/ui/TextField'
export { Toggle, type ToggleProps } from '@/ui/Toggle'
export { TotalFigure, type TotalFigureProps } from '@/ui/TotalFigure'
export type { TestIdProps } from '@/ui/types'
export { useLedgerColumn } from '@/ui/useLedgerColumn'
export { useReducedMotion } from '@/ui/useReducedMotion'
export { useVisualViewport, type VisualViewportState } from '@/ui/useVisualViewport'
