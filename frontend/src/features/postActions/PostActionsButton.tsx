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

  const stopPressEvent = (event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
  };

  const openMenu = (event?: GestureResponderEvent) => {
    stopPressEvent(event);
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
        onPressIn={stopPressEvent}
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
              <View style={styles.menuHeader}>
                <View style={styles.menuAvatar}>
                  <Text style={styles.menuAvatarText}>{(post.username || 'yo').slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={styles.menuHeaderText}>
                  <Text style={styles.menuTitle}>@{post.username || 'yosla'}</Text>
                  <Text style={styles.menuSubtitle}>{isOwner ? 'Oma julkaisu' : 'Julkaisun toiminnot'}</Text>
                </View>
              </View>
              {menuItems.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={styles.menuItem}
                  onPress={() => runAction(item.action)}
                  accessibilityRole="button"
                >
                  <View style={[styles.menuItemIcon, item.danger && styles.menuItemIconDanger]}>
                    <Ionicons name={item.icon} size={17} color={item.danger ? '#fecaca' : '#bfdbfe'} />
                  </View>
                  <Text style={[styles.menuItemText, item.danger && styles.menuItemDanger]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.menuItem, styles.cancelItem]} onPress={closeMenu}>
                <View style={styles.menuItemIcon}>
                  <Ionicons name="close-outline" size={17} color="#cbd5e1" />
                </View>
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
    backgroundColor: 'rgba(248,250,252,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.26)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  triggerCompact: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.48)',
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.28)',
    backgroundColor: '#07111f',
    padding: 10,
    shadowColor: '#020617',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 8,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 10,
    marginBottom: 8,
  },
  menuAvatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F62FE',
  },
  menuAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  menuHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  menuTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  menuSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  menuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    marginTop: 4,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  menuItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37,99,235,0.16)',
  },
  menuItemIconDanger: {
    backgroundColor: 'rgba(220,38,38,0.18)',
  },
  menuItemText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '900',
  },
  menuItemDanger: {
    color: '#fecaca',
  },
  cancelItem: {
    marginTop: 8,
    backgroundColor: 'rgba(15,23,42,0.58)',
  },
  cancelText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '900',
  },
});
