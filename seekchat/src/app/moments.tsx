import { useCallback, useRef, useState } from 'react';
import {
  Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import {
  createCharacterWithHome, db, ensureCharacter, getPersona, insertPost, listCharacters,
  listPersonas, listPosts, listReactions,
} from '../lib/db';
import type { Persona, Post, PostImage, Reaction } from '../lib/types';
import {
  charCommentReply, maybeCharPosts, publishPost, removePost, setMomentsFocused,
} from '../lib/feed';
import { insertUserReaction } from '../lib/db';
import { Avatar } from '../components/Avatar';
import { pickRawImage, renderPostImage } from '../lib/avatar';
import { useTheme } from '../lib/theme-context';

const MAX_IMAGES = 3;

interface FeedItem {
  post: Post;
  authorName: string; // 我 for user posts, her name for character posts
  authorAvatar: string | null;
  likedByMe: boolean;
  likes: string[]; // display names, revealed only
  comments: { name: string; text: string }[]; // revealed only
}

interface DraftImage extends PostImage {}

/** Visibility row state: a persona and (when registered) her characterId. */
interface VisRow {
  persona: Persona;
  characterId: string | null; // null = needs home-chat pick (0 or 2+ chats)
  convoCount: number;
}

export default function MomentsScreen() {
  const { th } = useTheme();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [composing, setComposing] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null); // full-screen image uri
  const [commentForId, setCommentForId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  // composer state
  const [text, setText] = useState('');
  const [images, setImages] = useState<DraftImage[]>([]);
  const [isDiary, setIsDiary] = useState(false);
  const [chatReadable, setChatReadable] = useState(true);
  const [visAll, setVisAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [visRows, setVisRows] = useState<VisRow[]>([]);
  const [homePickFor, setHomePickFor] = useState<Persona | null>(null);
  // Ref, not state: blocks the second tap of a double-tap before any re-render.
  const publishing = useRef(false);

  // Name map is built INSIDE reload (stable identity, deps []): a dep-as-signal
  // useMemo here either freezes stale names under the React Compiler or loops
  // the focus effect infinitely without it — and lazily-registered characters
  // get their real names on the next reload instead of '她'.
  const reload = useCallback(() => {
    const charName = new Map<string, string>();
    const charAvatar = new Map<string, string | null>();
    for (const c of listCharacters()) {
      const p = getPersona(c.personaId);
      charName.set(c.id, p?.name ?? '她');
      charAvatar.set(c.id, p?.avatarUri ?? null);
    }
    const now = Date.now();
    const items = listPosts().map((post) => {
      const revealed = listReactions(post.id).filter((r) => r.revealAt <= now);
      const name = (r: Reaction) =>
        r.authorType === 'user' ? '我' : charName.get(r.characterId) ?? '她';
      const isChar = post.authorType === 'character';
      return {
        post,
        authorName: isChar ? charName.get(post.authorId ?? '') ?? '她' : '我',
        authorAvatar: isChar ? charAvatar.get(post.authorId ?? '') ?? null : null,
        likedByMe: revealed.some((r) => r.authorType === 'user' && r.type === 'like'),
        likes: revealed.filter((r) => r.type === 'like').map(name),
        comments: revealed
          .filter((r) => r.type === 'comment')
          .map((r) => ({ name: name(r), text: r.content ?? '' })),
      };
    });
    setFeed(items);
  }, []);

  // Focused: load now and refresh every 30s so staggered reveals appear live.
  // Also give characters their daily chance to post (capped + probabilistic).
  useFocusEffect(
    useCallback(() => {
      setMomentsFocused(true);
      reload();
      void maybeCharPosts().then(reload);
      const t = setInterval(reload, 30_000);
      return () => {
        setMomentsFocused(false);
        clearInterval(t);
      };
    }, [reload]),
  );

  const openComposer = () => {
    publishing.current = false;
    setText('');
    setImages([]);
    setIsDiary(false);
    setChatReadable(true);
    setVisAll(true);
    setPicked(new Set());
    setVisRows(
      listPersonas().map((persona) => {
        const ch = ensureCharacter(persona.id);
        const n = db.getFirstSync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM conversations WHERE personaId = ?', [persona.id],
        );
        return { persona, characterId: ch?.id ?? null, convoCount: n?.n ?? 0 };
      }),
    );
    setComposing(true);
  };

  const addImage = async () => {
    if (images.length >= MAX_IMAGES) return;
    const raw = await pickRawImage();
    if (!raw) return;
    const uri = await renderPostImage(raw.uri);
    if (!uri) return;
    setImages((arr) => [...arr, { uri, desc: '' }]);
  };

  const pickHome = (persona: Persona, convoId: string) => {
    const ch = createCharacterWithHome(persona.id, convoId);
    setVisRows((rows) =>
      rows.map((r) => (r.persona.id === persona.id ? { ...r, characterId: ch.id } : r)),
    );
    setHomePickFor(null);
  };

  const descsMissing = images.some((i) => !i.desc.trim());
  const canPublish =
    text.trim().length > 0 && !descsMissing && (visAll || picked.size > 0);

  const publish = () => {
    if (!canPublish || publishing.current) return;
    publishing.current = true;
    const post = insertPost(
      text.trim(),
      JSON.stringify(images),
      isDiary ? 'diary' : 'moment',
      visAll ? 'all' : JSON.stringify([...picked]),
      isDiary && chatReadable,
    );
    setComposing(false);
    reload();
    void publishPost(post).then(reload);
  };

  const confirmDelete = (p: Post) => {
    Alert.alert('删除这条动态？', '她们的赞和评论也会一起消失。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => { removePost(p.id); reload(); },
      },
    ]);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };

  const renderItem = ({ item }: { item: FeedItem }) => {
    const imgs: PostImage[] = (() => {
      try { return JSON.parse(item.post.images); } catch { return []; }
    })();
    return (
      <Pressable style={s.card} onLongPress={() => confirmDelete(item.post)}>
        <View style={s.cardHead}>
          {item.post.authorType === 'character' && (
            <Avatar uri={item.authorAvatar} name={item.authorName} size={28} />
          )}
          <Text style={s.author}>{item.authorName}</Text>
          <Text style={s.time}>{fmtTime(item.post.createdAt)}</Text>
          {item.post.postType === 'diary' && (
            <Text style={[s.badge, { color: th.accent, borderColor: th.accent }]}>
              日记{item.post.chatReadable === 1 ? ' · 💬可读' : ''}
            </Text>
          )}
          {item.post.visibility !== 'all' && <Text style={s.lock}>🔒</Text>}
        </View>
        <Text style={s.body}>{item.post.text}</Text>
        {imgs.length > 0 && (
          <View style={s.imgRow}>
            {imgs.map((im, i) => (
              <Pressable key={i} onPress={() => setViewer(im.uri)}>
                <Image source={im.uri} style={s.thumb} contentFit="cover" />
              </Pressable>
            ))}
          </View>
        )}
        {item.post.authorType === 'character' && (
          <View style={s.actionRow}>
            <Pressable
              disabled={item.likedByMe}
              onPress={() => {
                insertUserReaction(item.post.id, 'like', null);
                reload();
              }}
            >
              <Text style={[s.actionTxt, item.likedByMe && { color: th.accent }]}>
                {item.likedByMe ? '❤️ 已赞' : '🤍 赞'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setCommentText('');
                setCommentForId(commentForId === item.post.id ? null : item.post.id);
              }}
            >
              <Text style={s.actionTxt}>💬 评论</Text>
            </Pressable>
          </View>
        )}
        {commentForId === item.post.id && (
          <View style={s.commentRow}>
            <TextInput
              style={s.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="评论她的动态…"
              autoFocus
            />
            <Pressable
              style={[s.btn, { backgroundColor: commentText.trim() ? th.accent : '#ccc' }]}
              onPress={() => {
                const t = commentText.trim();
                if (!t) return;
                insertUserReaction(item.post.id, 'comment', t);
                setCommentForId(null);
                setCommentText('');
                reload();
                void charCommentReply(item.post, t).then(reload);
              }}
            >
              <Text style={s.btnTxt}>发送</Text>
            </Pressable>
          </View>
        )}
        {(item.likes.length > 0 || item.comments.length > 0) && (
          <View style={[s.reactBox, { backgroundColor: th.accentSoft }]}>
            {item.likes.length > 0 && (
              <Text style={s.likeLine}>❤️ {item.likes.join('、')}</Text>
            )}
            {item.comments.map((c, i) => (
              <Text key={i} style={s.commentLine}>
                <Text style={{ fontWeight: '600', color: th.accent }}>{c.name}：</Text>
                {c.text}
              </Text>
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <FlatList
        data={feed}
        keyExtractor={(it) => it.post.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 90 }}
        ListEmptyComponent={
          <Text style={s.empty}>还没有动态——写下第一条吧，她看得到。</Text>
        }
      />
      <Pressable
        style={[s.fab, { backgroundColor: th.accent }]}
        onPress={openComposer}
      >
        <Text style={s.fabTxt}>＋</Text>
      </Pressable>

      <Modal visible={viewer !== null} transparent animationType="fade">
        <Pressable style={s.viewerBackdrop} onPress={() => setViewer(null)}>
          {viewer && <Image source={viewer} style={s.viewerImg} contentFit="contain" />}
        </Pressable>
      </Modal>

      <Modal visible={composing} transparent animationType="slide">
        <View style={s.composerBackdrop}>
          <View style={s.composer}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.title}>{isDiary ? '写日记' : '发动态'}</Text>
              <TextInput
                style={s.input}
                value={text}
                onChangeText={setText}
                placeholder={isDiary ? '今天想记下什么…' : '这一刻的想法…'}
                multiline
              />
              <View style={s.imgRow}>
                {images.map((im, i) => (
                  <View key={i} style={s.draftImgBox}>
                    <Image source={im.uri} style={s.thumb} contentFit="cover" />
                    <TextInput
                      style={s.descInput}
                      value={im.desc}
                      onChangeText={(t) =>
                        setImages((arr) => arr.map((x, j) => (j === i ? { ...x, desc: t } : x)))
                      }
                      placeholder="必填：她会“看到”这段描述"
                    />
                    <Pressable
                      onPress={() => setImages((arr) => arr.filter((_, j) => j !== i))}
                      hitSlop={8}
                    >
                      <Text style={s.removeImg}>移除</Text>
                    </Pressable>
                  </View>
                ))}
                {images.length < MAX_IMAGES && (
                  <Pressable style={s.addImg} onPress={() => void addImage()}>
                    <Text style={{ fontSize: 26, color: '#999' }}>＋</Text>
                  </Pressable>
                )}
              </View>
              <View style={s.row}>
                {(['moment', 'diary'] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[
                      s.chip,
                      (t === 'diary') === isDiary && { backgroundColor: th.accentSoft },
                    ]}
                    onPress={() => setIsDiary(t === 'diary')}
                  >
                    <Text style={s.chipTxt}>{t === 'diary' ? '日记' : '动态'}</Text>
                  </Pressable>
                ))}
              </View>
              {isDiary && (
                <View style={s.row}>
                  <Text style={s.label}>聊天内可读（她能在聊天里聊起这篇）</Text>
                  <Switch value={chatReadable} onValueChange={setChatReadable} />
                </View>
              )}
              <Text style={s.section}>谁可以看</Text>
              <View style={s.row}>
                <Pressable
                  style={[s.chip, visAll && { backgroundColor: th.accentSoft }]}
                  onPress={() => setVisAll(true)}
                >
                  <Text style={s.chipTxt}>所有角色</Text>
                </Pressable>
                <Pressable
                  style={[s.chip, !visAll && { backgroundColor: th.accentSoft }]}
                  onPress={() => setVisAll(false)}
                >
                  <Text style={s.chipTxt}>指定角色</Text>
                </Pressable>
              </View>
              {!visAll &&
                visRows.map((r) => (
                  <View key={r.persona.id} style={s.visRow}>
                    {r.characterId ? (
                      <Pressable
                        style={s.visTap}
                        onPress={() =>
                          setPicked((old) => {
                            const next = new Set(old);
                            if (next.has(r.characterId!)) next.delete(r.characterId!);
                            else next.add(r.characterId!);
                            return next;
                          })
                        }
                      >
                        <Text style={s.visName}>
                          {picked.has(r.characterId) ? '☑' : '☐'} {r.persona.name}
                        </Text>
                      </Pressable>
                    ) : r.convoCount === 0 ? (
                      <Text style={[s.visName, { color: '#bbb' }]}>
                        {r.persona.name}（还没有聊天）
                      </Text>
                    ) : (
                      <Pressable style={s.visTap} onPress={() => setHomePickFor(r.persona)}>
                        <Text style={[s.visName, { color: th.accent }]}>
                          {r.persona.name} — 有多个聊天，点这里选择她的主聊天
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
            </ScrollView>
            <View style={s.btnRow}>
              <Pressable style={s.btnGhost} onPress={() => setComposing(false)}>
                <Text style={{ color: '#666' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[s.btn, { backgroundColor: canPublish ? th.accent : '#ccc' }]}
                onPress={publish}
              >
                <Text style={s.btnTxt}>发布</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={homePickFor !== null} transparent animationType="fade">
        <Pressable style={s.viewerBackdrop} onPress={() => setHomePickFor(null)}>
          <View style={s.sheet}>
            <Text style={s.title}>哪个聊天是真正的她？</Text>
            <Text style={s.hint}>她的记忆、心情都住在这个聊天里；朋友圈互动会以它为准。</Text>
            {homePickFor &&
              db
                .getAllSync<{ id: string; title: string; updatedAt: number; lastSnippet: string | null }>(
                  `SELECT c.id, c.title, c.updatedAt,
                     (SELECT content FROM messages m
                      WHERE m.conversationId = c.id AND m.kind = 'normal'
                      ORDER BY m.createdAt DESC LIMIT 1) AS lastSnippet
                   FROM conversations c WHERE c.personaId = ? ORDER BY c.updatedAt DESC`,
                  [homePickFor.id],
                )
                .map((c) => (
                  <Pressable
                    key={c.id}
                    style={s.homeRow}
                    onPress={() => pickHome(homePickFor, c.id)}
                  >
                    <Text style={s.visName}>{c.title}</Text>
                    <Text style={s.hint} numberOfLines={1}>
                      {fmtTime(c.updatedAt)}
                      {c.lastSnippet ? ` · ${c.lastSnippet}` : ''}
                    </Text>
                  </Pressable>
                ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f6' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  author: { fontWeight: '700', fontSize: 15 },
  time: { color: '#999', fontSize: 12, flex: 1 },
  badge: {
    fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  lock: { fontSize: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  imgRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#eee' },
  reactBox: { borderRadius: 8, padding: 8, marginTop: 10, gap: 4 },
  actionRow: { flexDirection: 'row', gap: 18, marginTop: 10 },
  actionTxt: { fontSize: 13, color: '#666' },
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  commentInput: {
    flex: 1, fontSize: 13, padding: 8, backgroundColor: '#f2f2f2', borderRadius: 8,
  },
  likeLine: { fontSize: 13, color: '#444' },
  commentLine: { fontSize: 13, color: '#333', lineHeight: 19 },
  empty: { textAlign: 'center', color: '#999', marginTop: 80, lineHeight: 22 },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 54, height: 54,
    borderRadius: 27, alignItems: 'center', justifyContent: 'center', elevation: 4,
  },
  fabTxt: { color: '#fff', fontSize: 26, lineHeight: 30 },
  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImg: { width: '100%', height: '80%' },
  composerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  composer: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '88%',
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  hint: { fontSize: 12, color: '#888', lineHeight: 17, marginBottom: 10 },
  input: {
    minHeight: 90, maxHeight: 200, fontSize: 15, padding: 10,
    backgroundColor: '#f2f2f2', borderRadius: 10, textAlignVertical: 'top',
  },
  draftImgBox: { width: 120, gap: 4 },
  descInput: {
    fontSize: 12, padding: 6, backgroundColor: '#f2f2f2', borderRadius: 6,
  },
  removeImg: { fontSize: 12, color: '#a32d2d', textAlign: 'center' },
  addImg: {
    width: 96, height: 96, borderRadius: 8, backgroundColor: '#f2f2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: '#f2f2f2',
  },
  chipTxt: { fontSize: 13 },
  label: { flex: 1, fontSize: 13, color: '#444' },
  section: { fontSize: 13, fontWeight: '600', marginTop: 14, color: '#666' },
  visRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  visTap: { paddingVertical: 2 },
  visName: { fontSize: 14 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 },
  btn: { borderRadius: 10, paddingHorizontal: 22, paddingVertical: 10 },
  btnGhost: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnTxt: { color: '#fff', fontSize: 15 },
  sheet: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '86%',
  },
  homeRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
});
