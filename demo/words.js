// Wortschatz der Bot-Smallgroups im Demo (pro Kategorie, Schlüssel = Kategorie ohne Leerzeichen/Umlaute)
export const WORDS = {
  stadt: ['Aarau', 'Amsterdam', 'Basel', 'Bern', 'Berlin', 'Chur', 'Chicago', 'Dübendorf', 'Davos', 'Emmen', 'Edinburgh', 'Frauenfeld', 'Fribourg',
    'Genf', 'Glarus', 'Horgen', 'Hamburg', 'Interlaken', 'Istanbul', 'Jona', 'Jerusalem', 'Kloten', 'Köln', 'Luzern', 'Lugano', 'Lausanne', 'Montreux',
    'Madrid', 'Neuchâtel', 'Nazareth', 'Olten', 'Oslo', 'Pfäffikon', 'Paris', 'Rapperswil', 'Rom', 'Schaffhausen', 'Sion', 'Thun', 'Tokio', 'Uster',
    'Uznach', 'Vevey', 'Venedig', 'Winterthur', 'Wien', 'Zürich', 'Zug'],
  land: ['Albanien', 'Argentinien', 'Belgien', 'Brasilien', 'China', 'Chile', 'Dänemark', 'Deutschland', 'Estland', 'England', 'Frankreich', 'Finnland',
    'Griechenland', 'Ghana', 'Holland', 'Haiti', 'Italien', 'Irland', 'Japan', 'Jordanien', 'Kanada', 'Kenia', 'Litauen', 'Luxemburg', 'Mexiko',
    'Marokko', 'Norwegen', 'Nepal', 'Oman', 'Österreich', 'Peru', 'Polen', 'Russland', 'Rumänien', 'Spanien', 'Schweden', 'Tschechien', 'Tunesien',
    'Ungarn', 'Uganda', 'Vietnam', 'Venezuela', 'Wales', 'Zypern', 'Zambia'],
  fluss: ['Aare', 'Amazonas', 'Birs', 'Brahmaputra', 'Colorado', 'Donau', 'Doubs', 'Elbe', 'Emme', 'Fulda', 'Ganges', 'Glatt', 'Havel', 'Inn', 'Isar', 'Jordan',
    'Jangtse', 'Kander', 'Kongo', 'Limmat', 'Linth', 'Main', 'Mississippi', 'Nil', 'Neckar', 'Oder', 'Orinoco', 'Po', 'Rhein', 'Reuss', 'Rhone',
    'Saane', 'Sihl', 'Thur', 'Themse', 'Töss', 'Ural', 'Vltava', 'Weser', 'Wolga', 'Zihl'],
  biblischeperson: ['Abraham', 'Aaron', 'Boas', 'Barnabas', 'Cornelius', 'Daniel', 'David', 'Esther', 'Elia', 'Eva', 'Felix', 'Gideon', 'Goliath', 'Hanna', 'Hiob',
    'Isaak', 'Isai', 'Josua', 'Jona', 'Kain', 'Kaleb', 'Lea', 'Lukas', 'Mose', 'Maria', 'Noah', 'Nehemia', 'Obadja', 'Petrus', 'Paulus', 'Rut',
    'Rahel', 'Simson', 'Salomo', 'Timotheus', 'Thomas', 'Uria', 'Vasti', 'Zachäus', 'Zefanja'],
  worshipsong: ['Amazing Grace', 'Build My Life', 'Blessed Be Your Name', 'Cornerstone', 'Do It Again', 'Everlasting God', 'Firm Foundation', 'Goodness of God',
    'Gratitude', 'Holy Spirit', 'Here I Am to Worship', 'In Christ Alone', 'Jesus Messiah', 'King of Kings', 'Living Hope', 'Lord I Need You',
    'Mighty to Save', 'No Longer Slaves', 'Oceans', 'O Praise the Name', 'Promises', 'Reckless Love', 'Raise a Hallelujah', 'Shout to the Lord',
    'This Is Amazing Grace', 'Through It All', 'Unstoppable God', "Victor's Crown", 'What a Beautiful Name', 'Way Maker', 'Zehntausend Gründe'],
  essen: ['Apfelstrudel', 'Älplermagronen', 'Banane', 'Bratwurst', 'Croissant', 'Cervelat', 'Dattel', 'Döner', 'Erdbeere', 'Fondue', 'Falafel',
    'Gnocchi', 'Gipfeli', 'Hamburger', 'Hörnli', 'Ingwer', 'Joghurt', 'Kebab', 'Käse', 'Lasagne', 'Linzertorte', 'Müesli', 'Mango', 'Nudeln',
    'Nutella', 'Olive', 'Omelette', 'Pizza', 'Pommes', 'Raclette', 'Rösti', 'Spaghetti', 'Sushi', 'Tomate', 'Toast', 'Udon', 'Vanilleglace',
    'Wähe', 'Waffel', 'Zopf', 'Zucchetti'],
  tier: ['Affe', 'Adler', 'Bär', 'Biber', 'Chamäleon', 'Delfin', 'Dachs', 'Elefant', 'Eichhörnchen', 'Fuchs', 'Flamingo', 'Giraffe', 'Gämse',
    'Hund', 'Hai', 'Igel', 'Iltis', 'Jaguar', 'Katze', 'Koala', 'Löwe', 'Lama', 'Maus', 'Murmeltier', 'Nashorn', 'Nilpferd', 'Otter', 'Orca',
    'Pinguin', 'Panda', 'Reh', 'Rabe', 'Schaf', 'Steinbock', 'Tiger', 'Uhu', 'Uhu', 'Vogel', 'Wal', 'Wolf', 'Zebra', 'Ziege'],
  promi: ['Adele', 'Beyoncé', 'Bastian Baker', 'Cristiano Ronaldo', 'DJ Bobo', 'Drake', 'Ed Sheeran', 'Elon Musk', 'Federer', 'Greta Thunberg',
    'Harry Styles', 'Ice Spice', 'Justin Bieber', 'Kanye West', 'Lionel Messi', 'Lauryn Hill', 'Michael Jackson', 'Nemo', 'Olivia Rodrigo',
    'Pharrell', 'Rihanna', 'Shakira', 'Taylor Swift', 'Usain Bolt', 'Vin Diesel', 'Will Smith', 'Xherdan Shaqiri', 'Zendaya'],
  beruf: ['Arzt', 'Bäcker', 'Coiffeur', 'Dachdecker', 'Elektriker', 'Fotograf', 'Gärtner', 'Hebamme', 'Informatiker', 'Journalist', 'Koch',
    'Lehrer', 'Maler', 'Notar', 'Optiker', 'Pilot', 'Richter', 'Schreiner', 'Tierarzt', 'Uhrmacher', 'Verkäufer', 'Winzer', 'Zahnarzt'],
  name: ['Anna', 'Ben', 'Chiara', 'David', 'Elena', 'Fabio', 'Gian', 'Hanna', 'Ilaria', 'Jonas', 'Kim', 'Luca', 'Mia', 'Noah', 'Olivia', 'Paul',
    'Rahel', 'Sara', 'Tim', 'Urs', 'Valentina', 'Willi', 'Zoe'],
};

export const catKey = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const first = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')[0];

export function pickWord(category, letter) {
  const list = (WORDS[catKey(category)] || []).filter((w) => first(w) === first(letter));
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
