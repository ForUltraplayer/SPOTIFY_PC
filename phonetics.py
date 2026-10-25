# @file phonetics.py
# @author: ForUltraplayer
# @brief Convert dictionary-provided Japanese kana into approximate Hangul offline.
"""Rule-based reading aid; song-specific kanji readings may differ from a dictionary."""
import unicodedata

_ROWS = {
    'あいうえお': '아 이 우 에 오', 'かきくけこ': '카 키 쿠 케 코',
    'がぎぐげご': '가 기 구 게 고', 'さしすせそ': '사 시 스 세 소',
    'ざじずぜぞ': '자 지 즈 제 조', 'たちつてと': '타 치 츠 테 토',
    'だぢづでど': '다 지 즈 데 도', 'なにぬねの': '나 니 누 네 노',
    'はひふへほ': '하 히 후 헤 호', 'ばびぶべぼ': '바 비 부 베 보',
    'ぱぴぷぺぽ': '파 피 푸 페 포', 'まみむめも': '마 미 무 메 모',
    'やゆよ': '야 유 요', 'らりるれろ': '라 리 루 레 로', 'わゐゑを': '와 이 에 오',
    'ぁぃぅぇぉゃゅょゎゔ': '아 이 우 에 오 야 유 요 와 브',
}
_KANA = {kana: hangul for row, values in _ROWS.items() for kana, hangul in zip(row, values.split())}
for stem, readings in {
    'き': '캬 큐 쿄', 'ぎ': '갸 규 교', 'し': '샤 슈 쇼', 'じ': '쟈 쥬 죠',
    'ち': '차 추 초', 'ぢ': '쟈 쥬 죠', 'に': '냐 뉴 뇨', 'ひ': '햐 휴 효',
    'び': '뱌 뷰 뵤', 'ぴ': '퍄 퓨 표', 'み': '먀 뮤 묘', 'り': '랴 류 료',
}.items():
    _KANA.update({stem + small: reading for small, reading in zip('ゃゅょ', readings.split())})
_KANA.update(dict(zip(
    'いぇ うぃ うぇ うぉ ふぁ ふぃ ふぇ ふぉ ふゅ てぃ でぃ とぅ どぅ しぇ じぇ ちぇ つぁ つぃ つぇ つぉ ゔぁ ゔぃ ゔぇ ゔぉ ゔゅ くぁ くぃ くぇ くぉ ぐぁ'.split(),
    '예 위 웨 워 파 피 페 포 퓨 티 디 투 두 셰 제 체 차 치 체 초 바 비 베 보 뷰 콰 퀴 퀘 쿼 과'.split())))


def _final(output, batchim, standalone):
    if output and len(output[-1]) == 1:
        offset = ord(output[-1]) - 0xAC00
        if 0 <= offset < 11172 and offset % 28 == 0:
            output[-1] = chr(ord(output[-1]) + batchim)
            return
    output.append(standalone)


def kana_to_hangul(text):
    text = unicodedata.normalize('NFKC', text)
    text = ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in text)
    output, index = [], 0
    while index < len(text):
        char = text[index]
        if char == 'っ':
            following = text[index + 1:index + 2]
            final = 1 if following in 'かきくけこがぎぐげご' and following else 17 if following in 'ぱぴぷぺぽばびぶべぼ' and following else 19
            _final(output, final, '읏')
        elif char == 'ん':
            following = text[index + 1:index + 2]
            nasal = bool(following) and following in 'まみむめもばびぶべぼぱぴぷぺぽ'
            _final(output, 16 if nasal else 4, '음' if nasal else '응')
        elif char == 'ー':
            offset = ord(output[-1]) - 0xAC00 if output and len(output[-1]) == 1 else -1
            vowels = {0: '아', 1: '애', 2: '아', 3: '애', 4: '어', 5: '에', 6: '어', 7: '에',
                      8: '오', 9: '아', 10: '애', 11: '에', 12: '오', 13: '우', 14: '어',
                      15: '에', 16: '이', 17: '우', 18: '으', 19: '이', 20: '이'}
            output.append(vowels[(offset % 588) // 28] if 0 <= offset < 11172 else char)
        else:
            pair = text[index:index + 2]
            if len(pair) == 2 and pair in _KANA:
                output.append(_KANA[pair])
                index += 1
            else:
                # A held /su/ has an audible vowel, unlike the commonly devoiced ス.
                output.append('수' if char == 'す' and text[index + 1:index + 2] == 'ー' else _KANA.get(char, char))
        index += 1
    return ''.join(output)


def japanese_to_hangul(text, converter):
    """Preserve non-Japanese content; use isolated particle hints, not a grammar model."""
    output = []
    previous = ''
    for token in converter.convert(text):
        original = token['orig']
        reading = token['hira']
        # PyKakasi has no part-of-speech contract. Only adjust an isolated token
        # after Japanese text; ambiguous or song-specific readings remain approximate.
        if original in ('は', 'へ') and previous and ('\u3040' <= previous[-1] <= '\u9fff'):
            reading = 'わ' if original == 'は' else 'え'
        output.append(kana_to_hangul(reading))
        previous = original
    return ''.join(output)
