using System;
using System.Drawing;
using System.Windows.Forms;

public partial class MainWindow {
 void AddServiceCard(TableLayoutPanel parent,int column,string name,string description,Func<string> readStatus){
  var card=new TableLayoutPanel{Dock=DockStyle.Fill,BackColor=Theme.Surface,ColumnCount=1,RowCount=4,Padding=new Padding(15,12,15,12),Margin=new Padding(column==0?0:6,0,column==3?0:6,0)};
  card.RowStyles.Add(new RowStyle(SizeType.Absolute,33));card.RowStyles.Add(new RowStyle(SizeType.Absolute,48));card.RowStyles.Add(new RowStyle(SizeType.Percent,100));card.RowStyles.Add(new RowStyle(SizeType.Absolute,42));Theme.Round(card,20);parent.Controls.Add(card,column,0);
  card.Controls.Add(Label(name,16,Theme.Text,true),0,0);card.Controls.Add(Label(description,9,Theme.Muted,false),0,1);
  var state=Label(AccountIdentity(name)+"\n"+readStatus(),9,Theme.Accent,false);state.AccessibleName=name+" connection status";card.Controls.Add(state,0,2);
  var action=Button("Connect",delegate{ShowAccounts(name);},true);action.Dock=DockStyle.Fill;action.AutoSize=false;action.Margin=new Padding(0,3,0,0);card.Controls.Add(action,0,3);
  connectionTimer.Tick+=delegate{string text=AccountIdentity(name)+"\n"+readStatus();if(state.Text!=text)state.Text=text;bool active=name=="Twitch"?twitchStop!=null:name=="YouTube"?youtubeStop!=null:name=="Kick"?kickStop!=null:streamlabsStop!=null;string label=active?"Manage":"Connect";if(action.Text!=label)action.Text=label;};
 }
 void ShowNotificationPreferences(){using(var window=new Form{Text="Notifications",Size=new Size(640,460),MinimumSize=new Size(640,460),StartPosition=FormStartPosition.CenterParent,BackColor=Theme.Canvas,ForeColor=Theme.Text,Font=Font}){
  var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(28),RowCount=7,ColumnCount=1};foreach(int h in new[]{52,42,42,42,54,64,48})layout.RowStyles.Add(new RowStyle(SizeType.Absolute,h));window.Controls.Add(layout);
  layout.Controls.Add(Label("Make it feel like yours",22,Theme.Text,true),0,0);layout.Controls.Add(sound,0,1);layout.Controls.Add(desktop,0,2);
  var top=new CheckBox{Text="Keep the app above other windows",AutoSize=true,Checked=TopMost};top.CheckedChanged+=delegate{TopMost=top.Checked;};layout.Controls.Add(top,0,3);
  var actions=new FlowLayoutPanel{Dock=DockStyle.Fill};actions.Controls.Add(Button("Choose sound",delegate{ShowSoundSettings();},true));actions.Controls.Add(Button("Test notification",delegate{NotifyDesktop(new Alert{Name="UniversalStream Assist",Platform="Preview",Kind="Follow",Detail="Your notifications are ready.",Demo=true});}));layout.Controls.Add(actions,0,4);
  layout.Controls.Add(Label("Choose a WAV chime and preview your desktop alert.\\nPreferences are remembered on this Windows account.".Replace("\\n","\n"),10,Theme.Muted,false),0,5);layout.Controls.Add(Button("Done",delegate{window.Close();}),0,6);
  try{window.ShowDialog(this);}finally{layout.Controls.Remove(sound);layout.Controls.Remove(desktop);}
 }}
}

public partial class MainWindow {
 Form alertsWindow;
 void PopOutAlerts(){
  if(alertsWindow!=null&&!alertsWindow.IsDisposed){alertsWindow.WindowState=FormWindowState.Normal;alertsWindow.Activate();return;}
  var area=feed.Parent;var home=(TableLayoutPanel)area.Parent;var cell=home.GetPositionFromControl(area);
  var placeholder=Label("Alerts are open in a separate window.",12,Theme.Muted,false);
  var window=new Form{Text="Live alerts",Size=new Size(1050,480),MinimumSize=new Size(760,260),StartPosition=FormStartPosition.CenterScreen,BackColor=Theme.Canvas,ForeColor=Theme.Text,Font=Font,Icon=Icon};alertsWindow=window;
  var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(12),ColumnCount=1,RowCount=2};layout.RowStyles.Add(new RowStyle(SizeType.Absolute,52));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));window.Controls.Add(layout);
  var bar=new FlowLayoutPanel{Dock=DockStyle.Fill,AutoScroll=true,WrapContents=false};bar.Controls.Add(Button("Show main app",delegate{RestoreWindow();}));bar.Controls.Add(Button("Minimise main app",delegate{WindowState=FormWindowState.Minimized;}));bar.Controls.Add(Button("Dock alerts",delegate{window.Close();}));var pin=new CheckBox{Text="Always on top",AutoSize=true,Margin=new Padding(12,12,0,0)};pin.CheckedChanged+=delegate{window.TopMost=pin.Checked;};bar.Controls.Add(pin);layout.Controls.Add(bar,0,0);
  home.Controls.Remove(area);home.Controls.Add(placeholder,cell.Column,cell.Row);layout.Controls.Add(area,0,1);
  window.FormClosing+=delegate{layout.Controls.Remove(area);home.Controls.Remove(placeholder);placeholder.Dispose();home.Controls.Add(area,cell.Column,cell.Row);alertsWindow=null;};
  window.FormClosed+=delegate{if(!IsDisposed&&!Disposing)RestoreWindow();};
  SetupPopout(window,pin);window.Show();
 }
}

public partial class MainWindow {
 void ShowIntegrations(){using(var window=new Form{Text="Integrations",Size=new Size(780,650),MinimumSize=new Size(680,460),StartPosition=FormStartPosition.CenterParent,BackColor=Theme.Canvas,ForeColor=Theme.Text,Font=Font}){
  var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(26),ColumnCount=1,RowCount=3};
  layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
  layout.RowStyles.Add(new RowStyle(SizeType.Absolute,54));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,52));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));window.Controls.Add(layout);
  layout.Controls.Add(Label("Integrations",24,Theme.Text,true),0,0);layout.Controls.Add(Label("Connect your tools and personalise your stream.",11,Theme.Muted,false),0,1);
  var list=new FlowLayoutPanel{Dock=DockStyle.Fill,AutoScroll=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,Margin=Padding.Empty,Padding=new Padding(0,0,8,0),TabStop=true,AccessibleName="Integrations list"};layout.Controls.Add(list,0,2);
  AddIntegrationCard(list,"Pulsoid","Heart-rate rules for sounds, animated overlays and OBS scenes.","Open Pulsoid",delegate{ShowPulse();});
  AddIntegrationCard(list,"Streamer.bot & Lumia","Run Streamer.bot actions and Lumia lighting commands from stream events.","Configure",delegate{ShowTools();});
  AddIntegrationCard(list,"UniversalCollab","Connect UniversalCollab and manage your collaboration tools.","Open UniversalCollab",delegate{ShowCollab();});
  AddIntegrationCard(list,"Stream Deck","Set up quick controls for your stream from Stream Deck.","Open Stream Deck",delegate{ShowStreamDeck();});
  EventHandler resize=delegate{int width=Math.Max(100,list.ClientSize.Width-SystemInformation.VerticalScrollBarWidth-list.Padding.Horizontal);foreach(Control card in list.Controls)card.Width=width;};
  list.SizeChanged+=resize;window.Shown+=resize;resize(null,EventArgs.Empty);window.ShowDialog(this);
 }}
 void AddIntegrationCard(FlowLayoutPanel list,string title,string description,string action,EventHandler click){
  var card=new TableLayoutPanel{Height=142,Padding=new Padding(16),Margin=new Padding(0,0,0,14),BackColor=Theme.Surface,ColumnCount=2,RowCount=2};
  card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));card.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,184));card.RowStyles.Add(new RowStyle(SizeType.Absolute,38));card.RowStyles.Add(new RowStyle(SizeType.Percent,100));
  card.Controls.Add(Label(title,18,Theme.Text,true),0,0);card.Controls.Add(Label(description,10,Theme.Muted,false),0,1);
  var button=Button(action,click,true);button.AutoSize=false;button.Dock=DockStyle.Fill;button.Margin=new Padding(12,12,0,12);card.Controls.Add(button,1,0);card.SetRowSpan(button,2);Theme.Round(card,18);list.Controls.Add(card);
 }
}
