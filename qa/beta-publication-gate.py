#!/usr/bin/env python3
"""Non-deploy gate for a candidate beta page. Never publishes or submits forms.

Usage:
  python3 qa/beta-publication-gate.py --mode prelaunch
  python3 qa/beta-publication-gate.py --self-test
  python3 qa/beta-publication-gate.py --mode approved

The approved mode checks static markup only; it does NOT prove the form is live,
the external recipient permissions work, or publication is authorized.
"""
import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SAFE_VIEWFORM = re.compile(r"/forms/d/e/[A-Za-z0-9_-]+/viewform\Z")
EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}(?![\w-])")
DISCLOSE = ("연락 이메일", "iPhone", "갤럭시", "PC 병행", "7일차 설문 마감",
            "최대 14일", "미선정자", "삭제", "문의")
# Only public navigational links explicitly reviewed for this beta page.
# A relative ./ path is not automatically safe (it could expose qa/ or internal assets).
SAFE_LOCAL_LINKS = {"./index.html", "./privacy.html", "#steps"}

class HTML(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.text_parts = []
        self.meta = []
        self.feed(src)
    def handle_starttag(self, tag, attrs):
        attrs = {str(k).lower(): v for k, v in attrs}
        self.nodes.append((tag.lower(), attrs))
        if tag.lower() == 'meta':
            self.meta.append(attrs)
    def handle_data(self, data):
        self.text_parts.append(data)
    def tags(self, tag):
        return [a for t, a in self.nodes if t == tag]
    def by_id(self, id_):
        return [(t, a) for t, a in self.nodes if a.get('id') == id_]
    @property
    def text(self):
        return ' '.join(' '.join(self.text_parts).split())

def viewform(url):
    try:
        u = urlsplit(url)
        return (u.scheme == 'https' and u.hostname == 'docs.google.com'
                and u.netloc == 'docs.google.com' and not u.username and not u.password
                and bool(SAFE_VIEWFORM.fullmatch(u.path)) and not u.fragment
                and (not u.query or parse_qsl(u.query, keep_blank_values=True) ==
                     [('usp', 'sf_link')]))
    except (ValueError, TypeError):
        return False

def check(beta, privacy, mode, mock_mode=False):
    b, p = HTML(beta), HTML(privacy)
    errors = []
    def require(ok, reason):
        if not ok:
            errors.append(reason)
    require(len(b.by_id('apply')) == 1, 'id=apply must be unique')
    require(not (b.tags('form') or b.tags('script') or b.tags('iframe')),
            'embedded form/script/iframe blocked')
    require(all(w in b.text and w in p.text for w in DISCLOSE),
            'disclosure scope/retention/contacts differ or missing')
    require('비공개 설문' in b.text and '7일' in b.text,
            '7-day trial and private feedback required')
    require('총 10명' in b.text and '아이폰 5명' in b.text and
            '갤럭시 5명' in b.text and '추가 5명이 아닙니다' in b.text,
            '10 distinct participants, iPhone/Galaxy five each')
    links = [a.get('href', '') for a in b.tags('a')]
    require(not any(('spreadsheets' in x or '/edit' in x or
                     '/viewanalytics' in x or 'forms.gle' in x or
                     'drive.google.com' in x) for x in links),
            'internal/editor/spreadsheet/shortener/analytics URL forbidden')
    for link in links:
        if link in SAFE_LOCAL_LINKS:
            continue
        require(mode == 'approved' and viewform(link),
                'unapproved link (including internal/QA path): ' + link[:100])
    if mode == 'prelaunch':
        apply = b.by_id('apply')
        require(bool(apply and apply[0][0] == 'button' and
                     'disabled' in apply[0][1]), 'prelaunch button must be disabled')
        require('모집 상태: 접수 전' in b.text, 'reception must stay closed')
        require(not any(viewform(link) for link in links), 'application URL before approval')
        require(any(meta.get('name') == 'robots' and
                    'noindex' in meta.get('content', '') for meta in b.meta),
                'prelaunch page must be noindex')
    else:
        apply = b.by_id('apply')
        tag, attrs = apply[0] if apply else ('', {})
        target = attrs.get('href', '')
        require(tag == 'a' and viewform(target), 'apply must be HTTPS viewform anchor')
        require(len([x for x in links if viewform(x)]) == 1 and target in links,
                'one (and only one) response-form link on apply control')
        require('모집 상태: 접수 중' in b.text, 'approved status must show reception open')
        require('aria-describedby' in attrs, 'application status accessibility missing')
        if attrs.get('target') == '_blank':
            require({'noopener', 'noreferrer'} <= set(attrs.get('rel', '').split()),
                    'new tab must have noopener noreferrer')
        pending = ('승인 전', '검토안', '미개통', '문의·신청을 받지 않습니다',
                   '접수 전', '[확정', '[미정')
        require(not any(w in b.text or w in p.text for w in pending),
                'pending/closed/draft wording remains')
        require('개인정보 수집·이용에 동의' in b.text and
                '개인정보 수집·이용에 동의' in p.text,
                'both pages require explicit privacy-consent disclosure')
        beta_emails = set(EMAIL_RE.findall(b.text))
        privacy_emails = set(EMAIL_RE.findall(p.text))
        common = beta_emails & privacy_emails
        require(len(common) == 1 and beta_emails == privacy_emails,
                'one identical support and deletion email on both pages')
        require('삭제 요청' in b.text and '삭제 요청' in p.text,
                'deletion request wording required')
        if not mock_mode:
            require(bool(common) and not any(
                x.lower().endswith(('.test', '.example', '.invalid', '.localhost'))
                or x.lower().startswith(('test@', 'example@')) for x in common),
                'placeholder email is not a real contact')
    return errors

def mock(url='https://docs.google.com/forms/d/e/FAKE_TEST_ID/viewform',
         email='support@ssulmo.example.test'):
    notice = (f'연락 이메일, iPhone, 갤럭시, PC 병행 여부를 참가 선정과 체험 안내에 이용합니다. '
              f'미선정자 정보는 선정 결과 안내 후 삭제, 참가자 정보는 7일차 설문 마감 이후 '
              f'최대 14일 보유합니다. 개인정보 수집·이용에 동의하지 않으면 신청할 수 없습니다. '
              f'문의 및 삭제 요청: {email}.')
    beta = ('<html><body><p>총 10명, 아이폰 5명, 갤럭시 5명. '
            'PC 사용자는 추가 5명이 아닙니다. 7일 사용 후 7일차 비공개 설문.</p>'
            f'<a id="apply" href="{url}" target="_blank" rel="noopener noreferrer" '
            'aria-describedby="status">신청하기</a>'
            '<p id="status">모집 상태: 접수 중</p>'
            '<a href="./privacy.html">개인정보</a><a href="#steps">절차</a>'
            f'<p id="steps">{notice}</p></body></html>')
    return beta, f'<html><body><p>{notice}</p></body></html>'

def selftest(actual_beta, actual_privacy):
    results = []
    def run(name, expected, beta, privacy, mode, **kwargs):
        errors = check(beta, privacy, mode, **kwargs)
        passed = (not errors) == expected
        results.append((name, passed, errors))
    run('actual prelaunch stays closed', True, actual_beta, actual_privacy, 'prelaunch')
    run('prelaunch internal QA relative link rejected', False,
        actual_beta.replace('</footer>', '<a href="./qa/internal-review.html">QA</a></footer>'),
        actual_privacy, 'prelaunch')
    b, p = mock()
    run('synthetic approved markup accepted', True, b, p, 'approved', mock_mode=True)
    cases = [
      ('editor URL', b.replace('/viewform', '/edit'), p),
      ('analytics URL', b.replace('/viewform', '/viewanalytics'), p),
      ('spreadsheet URL', b.replace('docs.google.com/forms', 'docs.google.com/spreadsheets'), p),
      ('plain HTTP', b.replace('https://docs.google.com', 'http://docs.google.com'), p),
      ('unexpected host', b.replace('docs.google.com', 'www.docs.google.com'), p),
      ('short link', b.replace('https://docs.google.com/forms/d/e/FAKE_TEST_ID/viewform',
                              'https://forms.gle/FAKE'), p),
      ('form embed', b + '<form action="/post"></form>', p),
      ('script injection', b + '<script>alert(1)</script>', p),
      ('consent missing', b.replace('개인정보 수집·이용에 동의', '신청'), p),
      ('retention missing', b.replace('7일차 설문 마감 이후 최대 14일', '기간 미정'), p),
      ('email missing', b.replace('support@ssulmo.example.test', ''), p),
      ('contact mismatch', b, p.replace('support@ssulmo.example.test',
                                         'other@ssulmo.example.test')),
      ('wrong opening state', b.replace('모집 상태: 접수 중', '모집 상태: 접수 전'), p),
      ('duplicate URL', b.replace('<a href="#steps">', 
                                 '<a href="https://docs.google.com/forms/d/e/SECOND/viewform">중복</a>'
                                 '<a href="#steps">'), p),
      ('apply not link', b.replace('<a id="apply"', '<button id="apply"'), p),
      ('private survey URL', b.replace('<a href="#steps">',
                              '<a href="https://docs.google.com/forms/d/e/SEVENDAY/viewform">설문</a>'
                              '<a href="#steps">'), p),
      ('local internal QA link', b.replace('<a href="#steps">',
                             '<a href="./qa/internal-review.html">QA</a><a href="#steps">'), p),
      ('relative traversal link', b.replace('<a href="#steps">',
                               '<a href="../internal/response.csv">내부</a><a href="#steps">'), p),
      ('draft disclosure', b + '<p>승인 전 검토안</p>', p),
      ('unlabeled status', b.replace('aria-describedby="status"', ''), p),
      ('missing privacy policy', b, p.replace('미선정자', '비참가자')),
    ]
    for name, beta, privacy in cases:
        run(name + ' rejected', False, beta, privacy, 'approved', mock_mode=True)
    run('placeholder never accepted as real contact', False, b, p, 'approved')
    passed = sum(v for _, v, _ in results)
    print(f'BETA_TRANSITION_MOCK_GATE {passed}/{len(results)} expected outcomes PASS '
          '(synthetic only; no real signup or approval)')
    for name, ok, errs in results:
        print(('PASS ' if ok else 'FAIL ') + name +
              ((': ' + '; '.join(errs)) if not ok else ''))
    return passed == len(results)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['prelaunch', 'approved'])
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if (args.mode is None) == (not args.self_test):
        parser.error('choose exactly one of --mode or --self-test')
    beta = (ROOT / 'beta.html').read_text(encoding='utf-8')
    privacy = (ROOT / 'privacy.html').read_text(encoding='utf-8')
    if args.self_test:
        sys.exit(0 if selftest(beta, privacy) else 1)
    issues = check(beta, privacy, args.mode)
    print(f'BETA_PUBLICATION_GATE {args.mode.upper()} ' +
          ('PASS' if not issues else 'BLOCKED'))
    for issue in issues:
        print('BLOCKED: ' + issue)
    sys.exit(0 if not issues else 1)

if __name__ == '__main__':
    main()
