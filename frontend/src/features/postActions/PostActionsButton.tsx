import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type ActionablePost = {
  post_id: string;
  user_id?: string | null;
  username?: string | null;
  title?: string | null;
  text?: string | null;
};

type PostActionsButtonProps = {
  post: ActionablePost;
  currentUserId?: string | null;
  compact?: boolean;
  onEdit?: (post: ActionablePost) => void;
  onDelete?: (post: ActionablePost) => void;
  onHide?: (post: ActionablePost) => void;
  onReport?: (post: ActionablePost, reason?: 'inappropriate' | 'music_copyright') => void;
  onNotice?: (message: string) => void;
};

const getPostUrl = (postId: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/posts/${postId}`;
  }
  return `https://yosla.app/posts/${postId}`;
};

const copyTextToClipboard = async (text: string) => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
};

const showNotice = (message: string, onNotice?: (message: string) => void) => {
  onNotice?.(message);
  Alert.alert('YOSLA', message);
};

export const shareActionPost = async (post: ActionablePost, onNotice?: (message: string) => void) => {
  console.log('[post-actions] share clicked', { postId: post.post_id });
  const url = getPostUrl(post.post_id);
  const title = post.title || post.text?.slice(0, 80) || 'YOSLA julkaisu';
  const text = post.text || title;
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        showNotice('Jaettu onnistuneesti', onNotice);
        return;
      } catch (error) {
        console.log('[post-actions] native share failed', { postId: post.post_id, error });
      }
    }
    if (await copyTextToClipboard(url)) {
      console.log('[post-actions] copied link', { postId: post.post_id, url });
      showNotice('Linkki kopioitu', onNotice);
      return;
    }
    await Share.share({ title, message: `${text}\n${url}`, url });
    showNotice('Jaettu onnistuneesti', onNotice);
  } catch (error) {
    console.error('[post-actions] share failed', { postId: post.post_id, error });
    showNotice(error instanceof Error ? error.message : 'Jakaminen ei onnistunut', onNotice);
  }
};

export const copyPostLink = async (post: ActionablePost, onNotice?: (message: string) => void) => {
  const url = getPostUrl(post.post_id);
  try {
    if (await copyTextToClipboard(url)) {
      console.log('[post-actions] copied link', { postId: post.post_id, url });
      showNotice('Linkki kopioitu', onNotice);
      return;
    }
    await Share.share({ message: url, url });
    showNotice('Jaettu onnistuneesti', onNotice);
  } catch (error) {
    console.error('[post-actions] copy link failed', { postId: post.post_id, error });
    showNotice(error instanceof Error ? error.message : 'Linkin kopiointi ei onnistunut', onNotice);
  }
};

export function PostActionsButton({
  post,
  currentUserId,
  compact,
  onEdit,
  onDelete,
  onHide,
  onReport,
  onNotice,
}: PostActionsButtonProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwner = !!currentUserId && post.user_id === currentUserId;

  const openMenu = (event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
    console.log('[post-actions] menu opened', { postId: post.post_id, isOwner });
    setMenuVisible(true);
  };

  const closeMenu = () => setMenuVisible(false);

  const runAction = (action: () => void | Promise<void>) => {
    closeMenu();
    void action();
  };

  const menuItems = isOwner
    ? [
        { label: 'Edit post', icon: 'create-outline' as const, danger: false, action: () => onEdit?.(post) },
        { label: 'Delete post', icon: 'trash-outline' as const, danger: true, action: () => onDelete?.(post) },
        { label: 'Copy link', icon: 'link-outline' as const, danger: false, action: () => copyPostLink(post, onNotice) },
      ]
    : [
        { label: 'Copy link', icon: 'link-outline' as const, danger: false, action: () => copyPostLink(post, onNotice) },
        { label: 'Report post', icon: 'flag-outline' as const, danger: true, action: () => onReport?.(post, 'inappropriate') },
        { label: 'Tekijänoikeus / musiikki', icon: 'musical-notes-outline' as const, danger: true, action: () => onReport?.(post, 'music_copyright') },
        { label: 'Hide post', icon: 'eye-off-outline' as const, danger: false, action: () => onHide?.(post) },
      ];

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, compact && styles.triggerCompact]}
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel="Avaa julkaisun toimintovalikko"
      >
        <Ionicons name="ellipsis-horizontal" size={compact ? 17 : 19} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={closeMenu}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeMenu}>
          <View style={styles.menuWrap}>
            <TouchableOpacity activeOpacity={1} style={styles.menu} onPress={(event) => event.stopPropagation?.()}>
              <Text style={styles.menuTitle}>@{post.username || 'yosla'}</Text>
              {menuItems.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={styles.menuItem}
                  onPress={() => runAction(item.action)}
                  accessibilityRole="button"
                >
                  <Ionicons name={item.icon} size={18} color={item.danger ? '#ef4444' : '#0f172a'} />
                  <Text style={[styles.menuItemText, item.danger && styles.menuItemDanger]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.menuItem, styles.cancelItem]} onPress={closeMenu}>
                <Ionicons name="close-outline" size={18} color="#64748b" />
                <Text style={styles.cancelText}>Sulje</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  triggerCompact: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  menuWrap: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'stretch',
  },
  menu: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 8,
    shadowColor: '#020617',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 8,
  },
  menuTitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  menuItemText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  menuItemDanger: {
    color: '#ef4444',
  },
  cancelItem: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cancelText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '800',
  },
});
