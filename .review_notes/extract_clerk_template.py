from pathlib import Path
from bs4 import BeautifulSoup

source = Path('/home/ubuntu/upload/dashboard.clerk.com_apps_app_3Fd86AkLcndtqMqTR9mOUJVrO5e_instances_ins_3HI4sXwCNCAjRHUhbqMWLExohIc_c_1787827604248.html')
output = Path('/home/ubuntu/Clario-Complete-Backend/.review_notes/current-clerk-verification-template.re')
soup = BeautifulSoup(source.read_text(encoding='utf-8'), 'html.parser')
textarea = soup.select_one('textarea.rex-source')
if textarea is None:
    raise SystemExit('Unable to locate Clerk source editor textarea.')
output.write_text(textarea.get_text(), encoding='utf-8')
print(output)
